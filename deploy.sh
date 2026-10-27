#!/bin/bash
# Copies the built loader and HTML apps to the tablet in a single SSH
# connection (one password prompt if you don't use an SSH key).
#   ./deploy.sh [tablet-ip]          loader + html-apps (after ./build.sh)
#   ./deploy.sh [tablet-ip] <id>     a packaged app from ./package.sh
set -e
cd "$(dirname "$0")"
HOST="root@${1:-10.11.99.1}"
EXT=/home/root/xovi/exthome

if [ -n "$2" ]; then
    [ -d "output/$2" ] || { echo "error: output/$2 not found - run ./package.sh first" >&2; exit 1; }
    COPYFILE_DISABLE=1 tar -C output -cf - "$2" |
        ssh "$HOST" "rm -rf $EXT/appload/$2 && mkdir -p $EXT/appload && tar -C $EXT/appload -xof - && echo 'Deployed $2.'"
    echo "Reload AppLoad's app list to see it."
    exit 0
fi

[ -d output/htmlload ] || { echo "error: output/htmlload not found - run ./build.sh first" >&2; exit 1; }
# Replaces the loader; app folders are overwritten file by file so each
# app's saved .localstorage.json survives updates.
COPYFILE_DISABLE=1 tar -C output -cf - htmlload html-apps |
    ssh "$HOST" "rm -rf $EXT/appload/htmlload /tmp/htmlload-deploy && mkdir -p $EXT/appload $EXT/html-apps /tmp/htmlload-deploy && \
        tar -C /tmp/htmlload-deploy -xof - && \
        mv /tmp/htmlload-deploy/htmlload $EXT/appload/htmlload && \
        cp -r /tmp/htmlload-deploy/html-apps/. $EXT/html-apps/ && \
        rm -rf /tmp/htmlload-deploy && chmod +x $EXT/appload/htmlload/backend/entry && \
        echo 'Deployed to the tablet.'"
echo "Open 'HTML Apps' from AppLoad (reload its app list if it's not there)."
