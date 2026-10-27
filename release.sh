#!/bin/bash
# Builds a ready-to-copy release zip: no Qt or compiler needed to install it.
#   ./release.sh v1.0.0   -> output/remarkable-html-apps-v1.0.0.zip
# The zip mirrors /home/root/xovi/exthome/ on the tablet (appload/ and
# html-apps/) and includes install.sh and INSTALL.txt.
set -e
cd "$(dirname "$0")"
VERSION="${1:?usage: ./release.sh <version, e.g. v1.0.0>}"
NAME="remarkable-html-apps-$VERSION"

./build.sh >/dev/null
STAGE="output/$NAME"
rm -rf "$STAGE" "output/$NAME.zip"
mkdir -p "$STAGE/appload"
cp -R output/htmlload "$STAGE/appload/htmlload"
cp -R output/html-apps "$STAGE/html-apps"

cat > "$STAGE/install.sh" <<'EOF'
#!/bin/bash
# Installs HTML Apps (+ Chess) on a reMarkable with xovi and AppLoad.
#   ./install.sh [tablet-ip]      (default 10.11.99.1, the USB address)
# Asks for the tablet's root password once unless you use an SSH key.
set -e
cd "$(dirname "$0")"
HOST="root@${1:-10.11.99.1}"
EXT=/home/root/xovi/exthome
# One connection (one password prompt). Saved games (.localstorage.json)
# aren't in the archive, so they survive a reinstall.
COPYFILE_DISABLE=1 tar -cf - appload html-apps | ssh "$HOST" "
    if [ ! -d $EXT/appload ]; then echo 'error: $EXT/appload not found on the tablet - install xovi and AppLoad first.' >&2; exit 1; fi
    rm -rf $EXT/appload/htmlload && cd $EXT && tar -xof - && chmod +x appload/htmlload/backend/entry && echo 'Installed.'"
echo "Open AppLoad on the tablet (reload its app list) and start 'HTML Apps'."
EOF
chmod +x "$STAGE/install.sh"

cat > "$STAGE/INSTALL.txt" <<EOF
HTML Apps + Chess for reMarkable ($VERSION)

Needs: a reMarkable Paper Pro, Paper Pro Move or Paper Pure (64-bit) in
developer mode, with xovi and AppLoad installed.

1. Connect the tablet by USB and keep its screen on. If you use a VPN,
   allow local network traffic (otherwise 10.11.99.1 is unreachable).
2. From this folder, run:

     ./install.sh

   It asks for the tablet's root password (Settings > Help > About >
   Copyrights and licenses, bottom of General information).

   Or copy the files yourself:

     scp -r appload html-apps root@10.11.99.1:/home/root/xovi/exthome/

3. On the tablet, open AppLoad, reload its app list, and start "HTML Apps".

More HTML apps: copy any folder with an index.html into
/home/root/xovi/exthome/html-apps/ and tap Refresh in HTML Apps.
EOF

(cd output && zip -qr -X "$NAME.zip" "$NAME")
echo "Release: output/$NAME.zip"
