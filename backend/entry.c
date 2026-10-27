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
// Backend -> frontend
//   100 LIST_RESULT  JSON array of apps
//   101 READ_CHUNK   "<reqId>\n<index>\n<count>\n<data>"
//   102 READ_ERROR   "<reqId>\n<message>"
//   103 STORE_DATA   "<app dir>\n<json or empty>"
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
#include <unistd.h>

enum {
  MSG_LIST = 1,
  MSG_READ = 2,
  MSG_STORE_LOAD = 3,
  MSG_STORE_SAVE = 4,
  MSG_LIST_RESULT = 100,
  MSG_READ_CHUNK = 101,
  MSG_READ_ERROR = 102,
  MSG_STORE_DATA = 103,
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
  }
  if (g_rootCount > 0) return;

  const char *env = getenv("HTMLLOAD_ROOT");
  if (argc >= 3) add_root(argv[2], 0);
  else if (env && *env) add_root(env, 0);
  else add_root("/home/root/xovi/exthome/html-apps", 0);
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
  for (;;) {
    Header h;
    ssize_t r = recv(fd, &h, sizeof h, 0);
    if (r <= 0) break;
    size_t len = h.length > 0 ? (size_t)h.length : 0;
    if (len > cap) {
      cap = len;
      payload = realloc(payload, cap + 1);
    }
    // AppLoad always sends the payload as its own packet, even when it is
    // empty, so it must always be read: skipping an empty one would make
    // the next header read return 0 and look like the socket closed.
    r = recv(fd, payload, len > 0 ? len : 1, 0);
    if (r < 0 || (r == 0 && len > 0)) break;
    len = (size_t)r;
    payload[len] = 0;

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
      default:
        dlog("unknown message type %d", h.type);
    }
  }
  dlog("socket closed, exiting");
  free(payload);
  close(fd);
  return 0;
}
