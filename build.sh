#!/bin/bash
# Builds the HTML Apps loader for AppLoad and stages the bundled HTML apps.
#   output/htmlload/   -> /home/root/xovi/exthome/appload/htmlload/
#   output/html-apps/  -> /home/root/xovi/exthome/html-apps/
set -e
cd "$(dirname "$0")"

find_rcc() {
    local rcc
    rcc="$(command -v rcc || true)"
    if [ -z "$rcc" ] && command -v brew >/dev/null 2>&1; then
        rcc="$(brew --prefix qtbase 2>/dev/null)/share/qt/libexec/rcc"
    fi
    if [ -z "$rcc" ] || [ ! -x "$rcc" ]; then
        echo "error: rcc not found (install Qt6, e.g. 'brew install qtbase')" >&2
        exit 1
    fi
    echo "$rcc"
}

build_backend() {
    # Static musl binary: no dependency on the tablet's glibc version.
    command -v zig >/dev/null || { echo "error: zig not found ('brew install zig')" >&2; exit 1; }
    zig cc -target aarch64-linux-musl -static -O2 -s -o "$1" backend/entry.c
}

RCC="$(find_rcc)"
rm -rf output
mkdir -p output/htmlload/backend output/html-apps
cp manifest.json icon.png output/htmlload/
"$RCC" --binary -o output/htmlload/resources.rcc application.qrc
build_backend output/htmlload/backend/entry

for app in apps/*/; do
    rsync -a --exclude '.*' "$app" "output/html-apps/$(basename "$app")/"
done

echo "Built ./output"
echo "  output/htmlload  -> /home/root/xovi/exthome/appload/htmlload/"
echo "  output/html-apps -> /home/root/xovi/exthome/html-apps/"
echo "Or run ./deploy.sh [tablet-ip]"
