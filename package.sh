#!/bin/bash
# Turns one HTML folder into its own AppLoad app, so it shows up directly in
# the AppLoad menu and opens straight into the page (no launcher).
#
#   ./package.sh apps/chess [id] [name]
#
# Produces output/<id>/ -> copy to /home/root/xovi/exthome/appload/<id>/
# The HTML folder is copied into <id>/www/, which the backend detects.
set -e
cd "$(dirname "$0")"
SRC="${1:?usage: ./package.sh <html folder> [id] [name]}"
SRC="${SRC%/}"
ID="${2:-html-$(basename "$SRC" | tr '[:upper:] ' '[:lower:]-')}"
NAME="${3:-}"
if [ -z "$NAME" ] && [ -f "$SRC/manifest.json" ]; then
    NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/manifest.json" | head -1)"
fi
if [ -z "$NAME" ]; then
    NAME="$(sed -n 's:.*<title>\(.*\)</title>.*:\1:p' "$SRC/index.html" | head -1)"
fi
NAME="${NAME:-$(basename "$SRC")}"

RCC="$(command -v rcc || echo "$(brew --prefix qtbase 2>/dev/null)/share/qt/libexec/rcc")"
OUT="output/$ID"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# The frontend talks to AppLoad under the app's own id.
mkdir -p "$STAGE/ui"
sed "s/applicationID: \"htmlload\"/applicationID: \"$ID\"/" ui/main.qml > "$STAGE/ui/main.qml"
cp ui/HtmlApp.qml "$STAGE/ui/"
cp application.qrc "$STAGE/"

rm -rf "$OUT"
mkdir -p "$OUT/backend" "$OUT/www"
"$RCC" --binary -o "$OUT/resources.rcc" "$STAGE/application.qrc"
zig cc -target aarch64-linux-musl -static -O2 -s -o "$OUT/backend/entry" backend/entry.c
rsync -a --exclude '.*' "$SRC/" "$OUT/www/"
if [ -f "$SRC/icon.png" ]; then cp "$SRC/icon.png" "$OUT/icon.png"; else cp icon.png "$OUT/icon.png"; fi
cat > "$OUT/manifest.json" <<JSON
{
    "name": "$NAME",
    "loadsBackend": true,
    "entry": "/ui/main.qml",
    "id": "$ID",
    "supportsScaling": true,
    "canHaveMultipleFrontends": false
}
JSON
echo "Packaged $SRC as '$NAME' -> $OUT"
echo "Copy to /home/root/xovi/exthome/appload/$ID/ (or ./deploy.sh <ip> $ID)"
