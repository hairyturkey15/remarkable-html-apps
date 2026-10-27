#!/bin/bash
# Builds the HTML Apps loader for AppLoad and stages the bundled HTML apps.
#   output/htmlload/   -> /home/root/xovi/exthome/appload/htmlload/
#   output/html-apps/  -> /home/root/xovi/exthome/html-apps/
set -e
cd "$(dirname "$0")"

. tools/toolchain.sh

RCC="$(find_rcc)"
rm -rf output
mkdir -p output/htmlload/backend output/html-apps
cp manifest.json icon.png output/htmlload/
"$RCC" --binary -o output/htmlload/resources.rcc application.qrc
build_backend output/htmlload/backend/entry

for app in apps/*/; do
    copy_app "${app%/}" "output/html-apps/$(basename "$app")"
done

echo "Built ./output"
echo "  output/htmlload  -> /home/root/xovi/exthome/appload/htmlload/"
echo "  output/html-apps -> /home/root/xovi/exthome/html-apps/"
echo "Or run ./deploy.sh [tablet-ip]"
