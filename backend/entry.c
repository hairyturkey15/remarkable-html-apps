// htmlload backend
//
// Gives the QML frontend what QML alone cannot do on the tablet: list the
// HTML app folders, read their text files (index.html, .js, .json, ...) and
// persist each app's localStorage. Images are NOT sent through here - the
// frontend loads them straight from disk via file:// URLs.
//
// AppLoad wire protocol (same as the ti84emu backend, see rm-appload's
// src/management.cpp): every message is an 8-byte header
//   struct { int32 type; int32 length; }
// sent with its own send(), then `length` payload bytes in a second send().
// The socket is SOCK_SEQPACKET, so each send() is one message.
//
// Frontend -> backend
//   1 LIST        ""                     -> 100
//   2 READ        "<reqId>\n<abs path>"   -> 101 (one or more) or 102
//   3 STORE_LOAD  "<app dir>"            -> 103
//   4 STORE_SAVE  "<app dir>\n<json>"     (no reply)
//   5 SAVE_FILE   "<reqId>\n<name>\n<base64 data>"   -> 104
//   6 IMPORT_PDF  "<reqId>\n<exported name>\n<title>" -> 104
// Backend -> frontend
//   100 LIST_RESULT  JSON array of apps
//   101 READ_CHUNK   "<reqId>\n<index>\n<count>\n<data>"
//   102 READ_ERROR   "<reqId>\n<message>"
//   103 STORE_DATA   "<app dir>\n<json or empty>"
//   104 SAVE_RESULT  "<reqId>\nok\n<path>" or "<reqId>\nerror\n<message>"
//
// Saved files go to one exports folder (html-exports/ next to html-apps/,
// or exports/ inside a packaged app). IMPORT_PDF copies an exported PDF
// into the tablet's document library so it shows up in My Files.
// Framework:
//   -2 (0xFFFFFFFE) a frontend attached -> we push LIST_RESULT unprompted,
//   because the frontend's own first LIST can race our connect().

#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

enum {
  MSG_LIST = 1,
  MSG_READ = 2,
  MSG_STORE_LOAD = 3,
  MSG_STORE_SAVE = 4,
  MSG_SAVE_FILE = 5,
  MSG_IMPORT_PDF = 6,
  MSG_PART = 7,
  MSG_LIST_RESULT = 100,
  MSG_READ_CHUNK = 101,
  MSG_READ_ERROR = 102,
  MSG_STORE_DATA = 103,
  MSG_SAVE_RESULT = 104,
  SYS_NEW_COORDINATOR = -2,
};

// Kept well under the default SO_SNDBUF so a single datagram never fails
// with EMSGSIZE, whatever the kernel's wmem settings are.
#define CHUNK_SIZE (32 * 1024)
#define MAX_FILE_SIZE (16 * 1024 * 1024)
#define MAX_ROOTS 4

typedef struct {
  int32_t type;
  int32_t length;
} Header;

static char g_roots[MAX_ROOTS][PATH_MAX];
static int g_standalone[MAX_ROOTS];
static int g_rootCount = 0;
static char g_exports[PATH_MAX] = "";
static FILE *g_log = NULL;

static void dlog(const char *fmt, ...) {
  if (!g_log) return;
  va_list ap;
  va_start(ap, fmt);
  vfprintf(g_log, fmt, ap);
  va_end(ap);
  fputc('\n', g_log);
  fflush(g_log);
}

// ---------------------------------------------------------------------
// Growable string buffer
// ---------------------------------------------------------------------

typedef struct {
  char *data;
  size_t len, cap;
} Buf;

static void buf_reserve(Buf *b, size_t extra) {
  if (b->len + extra + 1 <= b->cap) return;
  size_t cap = b->cap ? b->cap : 256;
  while (cap < b->len + extra + 1) cap *= 2;
  b->data = realloc(b->data, cap);
  b->cap = cap;
}

static void buf_append(Buf *b, const char *s, size_t n) {
  buf_reserve(b, n);
  memcpy(b->data + b->len, s, n);
  b->len += n;
  b->data[b->len] = 0;
}

static void buf_puts(Buf *b, const char *s) { buf_append(b, s, strlen(s)); }

static void buf_json_string(Buf *b, const char *s) {
  buf_puts(b, "\"");
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    char esc[8];
    if (*p == '"' || *p == '\\') {
      esc[0] = '\\';
      esc[1] = (char)*p;
      buf_append(b, esc, 2);
    } else if (*p < 0x20) {
      snprintf(esc, sizeof esc, "\\u%04x", *p);
      buf_puts(b, esc);
    } else {
      buf_append(b, (const char *)p, 1);
    }
  }
  buf_puts(b, "\"");
}

// ---------------------------------------------------------------------
// Socket helpers
// ---------------------------------------------------------------------

static int send_msg(int fd, int32_t type, const char *data, size_t len) {
  Header h = {type, (int32_t)len};
  if (send(fd, &h, sizeof h, 0) != (ssize_t)sizeof h) return -1;
  if (len > 0 && send(fd, data, len, 0) != (ssize_t)len) return -1;
  return 0;
}

// ---------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------

static char *read_file(const char *path, size_t *outLen) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (size < 0 || size > MAX_FILE_SIZE) {
    fclose(f);
    errno = EFBIG;
    return NULL;
  }
  char *data = malloc((size_t)size + 1);
  size_t got = fread(data, 1, (size_t)size, f);
  fclose(f);
  data[got] = 0;
  if (outLen) *outLen = got;
  return data;
}

static int file_exists(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISREG(st.st_mode);
}

static int dir_exists(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISDIR(st.st_mode);
}

// Only paths inside one of our roots may be read or written; realpath()
// resolves "..", symlinks and the like before the prefix check.
static int path_allowed(const char *path) {
  char resolved[PATH_MAX];
  if (!realpath(path, resolved)) return 0;
  for (int i = 0; i < g_rootCount; i++) {
    char root[PATH_MAX];
    if (!realpath(g_roots[i], root)) continue;
    size_t n = strlen(root);
    if (strncmp(resolved, root, n) == 0 && (resolved[n] == '/' || resolved[n] == 0)) return 1;
  }
  return 0;
}

// Pulls "key": "value" out of a small JSON object. Enough for manifest.json,
// which only ever holds flat string fields we care about.
static int json_get_string(const char *json, const char *key, char *out, size_t outSize) {
  char pattern[128];
  snprintf(pattern, sizeof pattern, "\"%s\"", key);
  const char *p = strstr(json, pattern);
  if (!p) return 0;
  p += strlen(pattern);
  while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r' || *p == ':') p++;
  if (*p != '"') return 0;
  p++;
  size_t i = 0;
  while (*p && *p != '"' && i + 1 < outSize) {
    if (*p == '\\' && p[1]) p++;
    out[i++] = *p++;
  }
  out[i] = 0;
  return i > 0;
}

static int html_get_title(const char *html, char *out, size_t outSize) {
  const char *p = strcasestr(html, "<title>");
  if (!p) return 0;
  p += 7;
  const char *e = strcasestr(p, "</title>");
  if (!e) return 0;
  while (p < e && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) p++;
  size_t n = (size_t)(e - p);
  while (n > 0 && (p[n - 1] == ' ' || p[n - 1] == '\n' || p[n - 1] == '\r' || p[n - 1] == '\t')) n--;
  if (n >= outSize) n = outSize - 1;
  memcpy(out, p, n);
  out[n] = 0;
  return n > 0;
}

// Describes one app folder as a JSON object, or returns 0 if it has no
// HTML entry point.
static int describe_app(Buf *out, const char *dir, const char *fallbackName, int standalone) {
  char path[PATH_MAX], name[256], entry[256] = "index.html", icon[256] = "";
  snprintf(name, sizeof name, "%s", fallbackName);

  snprintf(path, sizeof path, "%s/manifest.json", dir);
  char *manifest = read_file(path, NULL);
  if (manifest) {
    json_get_string(manifest, "name", name, sizeof name);
    json_get_string(manifest, "entry", entry, sizeof entry);
    json_get_string(manifest, "icon", icon, sizeof icon);
    free(manifest);
  }

  char entryPath[PATH_MAX];
  snprintf(entryPath, sizeof entryPath, "%s/%s", dir, entry);
  if (!file_exists(entryPath)) return 0;

  if (!manifest) {
    char *html = read_file(entryPath, NULL);
    if (html) {
      html_get_title(html, name, sizeof name);
      free(html);
    }
  }
  if (!icon[0]) {
    snprintf(path, sizeof path, "%s/icon.png", dir);
    if (file_exists(path)) snprintf(icon, sizeof icon, "icon.png");
  }

  if (out->len > 1) buf_puts(out, ",");
  buf_puts(out, "{\"name\":");
  buf_json_string(out, name);
  buf_puts(out, ",\"dir\":");
  buf_json_string(out, dir);
  buf_puts(out, ",\"entry\":");
  buf_json_string(out, entry);
  buf_puts(out, ",\"icon\":");
  buf_json_string(out, icon);
  buf_puts(out, ",\"exports\":");
  buf_json_string(out, g_exports);
  buf_puts(out, standalone ? ",\"standalone\":true}" : ",\"standalone\":false}");
  return 1;
}

static int compare_names(const void *a, const void *b) {
  return strcasecmp(*(const char *const *)a, *(const char *const *)b);
}

static void send_list(int fd) {
  Buf out = {0};
  buf_puts(&out, "[");
  for (int r = 0; r < g_rootCount; r++) {
    if (g_standalone[r]) {
      describe_app(&out, g_roots[r], "App", 1);
      continue;
    }
    DIR *d = opendir(g_roots[r]);
    if (!d) continue;
    char *names[512];
    int count = 0;
    struct dirent *ent;
    while ((ent = readdir(d)) && count < 512) {
      if (ent->d_name[0] == '.') continue;
      names[count++] = strdup(ent->d_name);
    }
    closedir(d);
    qsort(names, (size_t)count, sizeof names[0], compare_names);
    for (int i = 0; i < count; i++) {
      char dir[PATH_MAX];
      snprintf(dir, sizeof dir, "%s/%s", g_roots[r], names[i]);
      if (dir_exists(dir)) describe_app(&out, dir, names[i], 0);
      free(names[i]);
    }
  }
  buf_puts(&out, "]");
  dlog("LIST -> %s", out.data);
  send_msg(fd, MSG_LIST_RESULT, out.data, out.len);
  free(out.data);
}

static void send_error(int fd, const char *reqId, const char *msg) {
  Buf out = {0};
  buf_puts(&out, reqId);
  buf_puts(&out, "\n");
  buf_puts(&out, msg);
  send_msg(fd, MSG_READ_ERROR, out.data, out.len);
  free(out.data);
}

static void handle_read(int fd, const char *payload) {
  const char *nl = strchr(payload, '\n');
  if (!nl) return;
  char reqId[64];
  size_t idLen = (size_t)(nl - payload);
  if (idLen >= sizeof reqId) idLen = sizeof reqId - 1;
  memcpy(reqId, payload, idLen);
  reqId[idLen] = 0;
  const char *path = nl + 1;

  if (!path_allowed(path)) {
    send_error(fd, reqId, "not found or outside the HTML app folders");
    dlog("READ denied: %s", path);
    return;
  }
  size_t len = 0;
  char *data = read_file(path, &len);
  if (!data) {
    send_error(fd, reqId, strerror(errno));
    return;
  }

  // Split at UTF-8 character boundaries: AppLoad decodes every message
  // to a QString on its own, so a multi-byte character cut in half would
  // turn into replacement characters.
  size_t starts[(MAX_FILE_SIZE / CHUNK_SIZE) + 2];
  int count = 0;
  size_t pos = 0;
  do {
    starts[count++] = pos;
    size_t end = pos + CHUNK_SIZE;
    if (end >= len) break;
    while (end > pos && ((unsigned char)data[end] & 0xC0) == 0x80) end--;
    pos = end;
  } while (pos < len);

  for (int i = 0; i < count; i++) {
    size_t s = starts[i];
    size_t e = (i + 1 < count) ? starts[i + 1] : len;
    char head[128];
    int hn = snprintf(head, sizeof head, "%s\n%d\n%d\n", reqId, i, count);
    Buf msg = {0};
    buf_append(&msg, head, (size_t)hn);
    buf_append(&msg, data + s, e - s);
    send_msg(fd, MSG_READ_CHUNK, msg.data, msg.len);
    free(msg.data);
  }
  free(data);
}

static void storage_path(const char *appDir, char *out, size_t outSize) {
  snprintf(out, outSize, "%s/.localstorage.json", appDir);
}

static void handle_store_load(int fd, const char *appDir) {
  Buf out = {0};
  buf_puts(&out, appDir);
  buf_puts(&out, "\n");
  if (dir_exists(appDir) && path_allowed(appDir)) {
    char path[PATH_MAX];
    storage_path(appDir, path, sizeof path);
    char *data = read_file(path, NULL);
    if (data) {
      buf_puts(&out, data);
      free(data);
    }
  }
  send_msg(fd, MSG_STORE_DATA, out.data, out.len);
  free(out.data);
}

static void handle_store_save(const char *payload) {
  const char *nl = strchr(payload, '\n');
  if (!nl) return;
  char appDir[PATH_MAX];
  size_t n = (size_t)(nl - payload);
  if (n >= sizeof appDir) return;
  memcpy(appDir, payload, n);
  appDir[n] = 0;
  if (!dir_exists(appDir) || !path_allowed(appDir)) return;

  // Write-then-rename, so a crash mid-save never leaves half a file.
  char path[PATH_MAX], tmp[PATH_MAX];
  storage_path(appDir, path, sizeof path);
  snprintf(tmp, sizeof tmp, "%s.tmp", path);
  FILE *f = fopen(tmp, "wb");
  if (!f) return;
  fwrite(nl + 1, 1, strlen(nl + 1), f);
  fflush(f);
  fsync(fileno(f));
  fclose(f);
  rename(tmp, path);
}

// ---------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------

static void send_save_result(int fd, const char *reqId, int ok, const char *text) {
  Buf out = {0};
  buf_puts(&out, reqId);
  buf_puts(&out, ok ? "\nok\n" : "\nerror\n");
  buf_puts(&out, text);
  send_msg(fd, MSG_SAVE_RESULT, out.data, out.len);
  free(out.data);
}

// Splits "a\nb\nrest" in place; returns the number of fields found.
static int split_fields(char *payload, char **fields, int max) {
  int n = 0;
  char *p = payload;
  while (n < max - 1) {
    char *nl = strchr(p, '\n');
    if (!nl) break;
    *nl = 0;
    fields[n++] = p;
    p = nl + 1;
  }
  fields[n++] = p;
  return n;
}

// Names are plain file names: no directories, nothing hidden.
static int name_ok(const char *name) {
  if (!name[0] || name[0] == '.' || strlen(name) > 120) return 0;
  for (const char *c = name; *c; c++) {
    if (!((*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') ||
          *c == '.' || *c == '-' || *c == '_' || *c == ' ')) return 0;
  }
  return 1;
}

static int b64_value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62;
  if (c == '/' || c == '_') return 63;
  return -1;
}

static size_t b64_decode(const char *in, unsigned char *out) {
  size_t n = 0;
  int bits = 0, acc = 0;
  for (; *in; in++) {
    int v = b64_value(*in);
    if (v < 0) continue;  // padding, whitespace
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (unsigned char)((acc >> bits) & 0xFF);
    }
  }
  return n;
}

static void handle_save_file(int fd, char *payload) {
  char *f[3];
  if (split_fields(payload, f, 3) < 3) return;
  if (!name_ok(f[1])) {
    send_save_result(fd, f[0], 0, "invalid file name");
    return;
  }
  if (!g_exports[0] || (mkdir(g_exports, 0755) != 0 && errno != EEXIST)) {
    send_save_result(fd, f[0], 0, "no exports folder");
    return;
  }
  char path[PATH_MAX], tmp[PATH_MAX];
  snprintf(path, sizeof path, "%s/%s", g_exports, f[1]);
  snprintf(tmp, sizeof tmp, "%s.tmp", path);
  unsigned char *data = malloc(strlen(f[2]) * 3 / 4 + 4);
  size_t len = b64_decode(f[2], data);
  FILE *out = fopen(tmp, "wb");
  if (!out || fwrite(data, 1, len, out) != len) {
    if (out) fclose(out);
    free(data);
    send_save_result(fd, f[0], 0, strerror(errno));
    return;
  }
  fclose(out);
  free(data);
  rename(tmp, path);
  dlog("saved %s (%zu bytes)", path, len);
  send_save_result(fd, f[0], 1, path);
}

// Adds an exported PDF to xochitl's document store. The tablet's library
// only picks new documents up after xochitl restarts (or the tablet reboots).
static void handle_import_pdf(int fd, char *payload) {
  char *f[3];
  if (split_fields(payload, f, 3) < 3) return;
  const char *lib = "/home/root/.local/share/remarkable/xochitl";
  char src[PATH_MAX], uuid[64] = "", path[PATH_MAX];
  if (!name_ok(f[1]) || !dir_exists(lib)) {
    send_save_result(fd, f[0], 0, "no document library on this device");
    return;
  }
  snprintf(src, sizeof src, "%s/%s", g_exports, f[1]);
  size_t len = 0;
  char *pdf = read_file(src, &len);
  FILE *u = fopen("/proc/sys/kernel/random/uuid", "r");
  if (u) {
    if (fgets(uuid, sizeof uuid, u)) uuid[strcspn(uuid, "\n")] = 0;
    fclose(u);
  }
  if (!pdf || !uuid[0]) {
    free(pdf);
    send_save_result(fd, f[0], 0, "could not read the exported PDF");
    return;
  }
  snprintf(path, sizeof path, "%s/%s.pdf", lib, uuid);
  FILE *out = fopen(path, "wb");
  if (!out) {
    free(pdf);
    send_save_result(fd, f[0], 0, strerror(errno));
    return;
  }
  fwrite(pdf, 1, len, out);
  fclose(out);
  free(pdf);

  long long now = (long long)time(NULL) * 1000;
  Buf meta = {0};
  char num[64];
  buf_puts(&meta, "{\"createdTime\":\"");
  snprintf(num, sizeof num, "%lld", now);
  buf_puts(&meta, num);
  buf_puts(&meta, "\",\"lastModified\":\"");
  buf_puts(&meta, num);
  buf_puts(&meta, "\",\"parent\":\"\",\"pinned\":false,\"type\":\"DocumentType\",\"visibleName\":");
  buf_json_string(&meta, f[2][0] ? f[2] : f[1]);
  buf_puts(&meta, "}");
  snprintf(path, sizeof path, "%s/%s.metadata", lib, uuid);
  out = fopen(path, "wb");
  if (out) { fwrite(meta.data, 1, meta.len, out); fclose(out); }
  free(meta.data);
  snprintf(path, sizeof path, "%s/%s.content", lib, uuid);
  out = fopen(path, "wb");
  if (out) { fputs("{\"fileType\":\"pdf\"}", out); fclose(out); }
  dlog("imported %s as %s", src, uuid);
  send_save_result(fd, f[0], 1, uuid);
}

// ---------------------------------------------------------------------

static void add_root(const char *path, int standalone) {
  if (g_rootCount >= MAX_ROOTS || !dir_exists(path)) return;
  snprintf(g_roots[g_rootCount], PATH_MAX, "%s", path);
  g_standalone[g_rootCount] = standalone;
  g_rootCount++;
  dlog("root %s (%s)", path, standalone ? "standalone" : "shared");
}

static void setup_roots(int argc, char **argv) {
  // A packaged app ships its HTML in <app>/www next to backend/entry. Then
  // it is a single-app package and opens straight into that page.
  char exe[PATH_MAX];
  ssize_t n = readlink("/proc/self/exe", exe, sizeof exe - 1);
  if (n > 0) {
    exe[n] = 0;
    char *slash = strrchr(exe, '/');  // .../backend/entry
    if (slash) *slash = 0;
    slash = strrchr(exe, '/');  // .../backend
    if (slash) *slash = 0;
    char www[PATH_MAX];
    snprintf(www, sizeof www, "%s/www", exe);
    add_root(www, 1);
    if (g_rootCount > 0) snprintf(g_exports, sizeof g_exports, "%s/exports", exe);
  }
  if (g_rootCount > 0) return;

  const char *env = getenv("HTMLLOAD_ROOT");
  if (argc >= 3) add_root(argv[2], 0);
  else if (env && *env) add_root(env, 0);
  else add_root("/home/root/xovi/exthome/html-apps", 0);
  // Shared exports folder next to the apps folder.
  if (g_rootCount > 0) {
    snprintf(g_exports, sizeof g_exports, "%s", g_roots[0]);
    char *slash = strrchr(g_exports, '/');
    if (slash) strcpy(slash + 1, "html-exports");
  }
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <appload socket path> [html-apps dir]\n", argv[0]);
    return 1;
  }
  g_log = fopen("/tmp/htmlload-debug.log", "a");
  dlog("=== htmlload starting, socket %s ===", argv[1]);
  setup_roots(argc, argv);

  int fd = socket(AF_UNIX, SOCK_SEQPACKET, 0);
  if (fd < 0) {
    perror("socket");
    return 1;
  }
  int sndbuf = 1 << 20;
  setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &sndbuf, sizeof sndbuf);

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof addr);
  addr.sun_family = AF_UNIX;
  strncpy(addr.sun_path, argv[1], sizeof addr.sun_path - 1);

  // AppLoad binds the socket on a separate thread that may not be ready yet.
  int connected = 0;
  for (int attempt = 0; attempt < 100 && !connected; attempt++) {
    if (connect(fd, (struct sockaddr *)&addr, sizeof addr) == 0) connected = 1;
    else usleep(20000);
  }
  if (!connected) {
    dlog("connect failed: %s", strerror(errno));
    return 1;
  }
  dlog("connected");

  // Grows to the largest message seen (localStorage saves can be big).
  size_t cap = 64 * 1024;
  char *payload = malloc(cap + 1);
  // AppLoad can't send one datagram over the socket's buffer size (~208 KB),
  // so the frontend splits big messages: MSG_PART pieces are collected here
  // and prepended to the next real message.
  char *part = NULL;
  size_t partLen = 0;
  Header h;
  int haveHeader = 0;
  for (;;) {
    ssize_t r;
    if (!haveHeader) {
      r = recv(fd, &h, sizeof h, 0);
      if (r <= 0) break;
      if (r != (ssize_t)sizeof h) {
        dlog("short header (%zd bytes), skipped", r);
        continue;
      }
    }
    haveHeader = 0;
    size_t len = h.length > 0 ? (size_t)h.length : 0;
    if (len + sizeof h > cap) {
      cap = len + sizeof h;
      payload = realloc(payload, cap + 1);
    }
    // AppLoad always sends the payload as its own packet, even when it is
    // empty, so it must always be read: skipping an empty one would make
    // the next header read return 0 and look like the socket closed.
    r = recv(fd, payload, cap, 0);
    if (r < 0 || (r == 0 && len > 0)) break;
    // If AppLoad failed to send a payload, the next packet is already the
    // following message's header: resynchronise on it instead of drifting.
    if ((size_t)r != (len > 0 ? len : (size_t)r)) {
      dlog("type %d: expected %zu bytes, got %zd", h.type, len, r);
      if (r == (ssize_t)sizeof h) {
        memcpy(&h, payload, sizeof h);
        haveHeader = 1;
      }
      free(part);
      part = NULL;
      partLen = 0;
      continue;
    }
    len = (size_t)r;
    payload[len] = 0;

    if (h.type == MSG_PART) {
      char *grown = realloc(part, partLen + len + 1);
      if (!grown || partLen + len > MAX_FILE_SIZE * 2) {
        dlog("message too large, dropped");
        free(grown ? grown : part);
        part = NULL;
        partLen = 0;
        continue;
      }
      part = grown;
      memcpy(part + partLen, payload, len);
      partLen += len;
      continue;
    }
    if (part) {
      if (partLen + len > cap) {
        cap = partLen + len;
        payload = realloc(payload, cap + 1);
      }
      memmove(payload + partLen, payload, len);
      memcpy(payload, part, partLen);
      len += partLen;
      payload[len] = 0;
      free(part);
      part = NULL;
      partLen = 0;
    }

    switch (h.type) {
      case SYS_NEW_COORDINATOR:
      case MSG_LIST:
        send_list(fd);
        break;
      case MSG_READ:
        handle_read(fd, payload);
        break;
      case MSG_STORE_LOAD:
        handle_store_load(fd, payload);
        break;
      case MSG_STORE_SAVE:
        handle_store_save(payload);
        break;
      case MSG_SAVE_FILE:
        handle_save_file(fd, payload);
        break;
      case MSG_IMPORT_PDF:
        handle_import_pdf(fd, payload);
        break;
      default:
        dlog("unknown message type %d", h.type);
    }
  }
  dlog("socket closed, exiting");
  free(payload);
  close(fd);
  return 0;
}
