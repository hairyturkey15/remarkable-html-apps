# Sourced by build.sh and package.sh. Finds the build tools on macOS and
# Linux; override with RCC=/path/to/rcc or BACKEND_CC=<aarch64 compiler>.

# Qt's resource compiler. Distros rarely put Qt 6's rcc on PATH, so look in
# the usual libexec directories first. Qt 5's rcc also works: the tablet's
# Qt 6 still reads its format. TOOLCHAIN_ROOT prefixes the fixed paths
# (only used to test this search).
find_rcc() {
    local root="${TOOLCHAIN_ROOT:-}" c q dir
    if [ -n "${RCC:-}" ]; then
        [ -x "$RCC" ] && { echo "$RCC"; return 0; }
        echo "error: RCC=$RCC is not an executable" >&2
        return 1
    fi
    for q in qmake6 qtpaths6; do
        command -v "$q" >/dev/null 2>&1 || continue
        if [ "$q" = qmake6 ]; then dir="$("$q" -query QT_HOST_LIBEXECS 2>/dev/null)"
        else dir="$("$q" --query QT_HOST_LIBEXECS 2>/dev/null)"; fi
        [ -n "$dir" ] && [ -x "$dir/rcc" ] && { echo "$dir/rcc"; return 0; }
    done
    for c in \
        "$root"/usr/lib/qt6/libexec/rcc \
        "$root"/usr/lib/*-linux-gnu/qt6/libexec/rcc \
        "$root"/usr/lib64/qt6/libexec/rcc \
        "$root"/usr/libexec/qt6/rcc \
        "$root"/usr/lib/qt6/rcc \
        "$root"/usr/lib/qt6/bin/rcc \
        "$root"/opt/homebrew/opt/qtbase/share/qt/libexec/rcc \
        "$root"/usr/local/opt/qtbase/share/qt/libexec/rcc; do
        [ -x "$c" ] && { echo "$c"; return 0; }
    done
    if [ -z "$root" ] && command -v brew >/dev/null 2>&1; then
        c="$(brew --prefix qtbase 2>/dev/null)/share/qt/libexec/rcc"
        [ -x "$c" ] && { echo "$c"; return 0; }
    fi
    for c in rcc-qt6 rcc rcc-qt5; do
        [ -z "$root" ] && command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return 0; }
    done
    for c in "$root"/usr/lib/qt5/bin/rcc "$root"/usr/lib/*-linux-gnu/qt5/bin/rcc "$root"/usr/lib64/qt5/bin/rcc; do
        [ -x "$c" ] && { echo "$c"; return 0; }
    done
    cat >&2 <<'EOF'
error: Qt's rcc tool was not found. Install it, or set RCC=/path/to/rcc:
  Debian/Ubuntu:  sudo apt install qt6-base-dev-tools
  Fedora:         sudo dnf install qt6-qtbase-devel
  Arch:           sudo pacman -S qt6-base
  macOS:          brew install qtbase
EOF
    return 1
}

# Builds the backend as a static aarch64 binary, so it doesn't depend on the
# tablet's C library. Uses zig if present, else an aarch64 cross-gcc.
build_backend() {
    local out="$1" src="backend/entry.c" cc
    if [ -n "${BACKEND_CC:-}" ]; then
        $BACKEND_CC -static -O2 -s -o "$out" "$src"
        return
    fi
    if command -v zig >/dev/null 2>&1; then
        zig cc -target aarch64-linux-musl -static -O2 -s -o "$out" "$src"
        return
    fi
    for cc in aarch64-linux-musl-gcc aarch64-linux-gnu-gcc; do
        if command -v "$cc" >/dev/null 2>&1; then
            "$cc" -static -O2 -s -o "$out" "$src"
            return
        fi
    done
    cat >&2 <<'EOF'
error: no aarch64 compiler found for the backend. Install one of:
  zig (any OS):   https://ziglang.org/download/  (or: brew install zig / sudo pacman -S zig / sudo snap install zig --classic --beta)
  Debian/Ubuntu:  sudo apt install gcc-aarch64-linux-gnu
  Fedora:         sudo dnf install gcc-aarch64-linux-gnu sysroot-aarch64-fc*-glibc
Or set BACKEND_CC to your cross-compiler.
EOF
    return 1
}

# Copies an HTML app folder, leaving out dotfiles (saved localStorage etc).
copy_app() {
    mkdir -p "$2"
    cp -R "$1"/. "$2"/
    find "$2" -mindepth 1 -name '.*' -exec rm -rf {} +
}
