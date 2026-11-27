#!/bin/bash
# Exports the grid's own frames for the launch video, then renders it.
set -e
cd "$(dirname "$0")/../.."
mkdir -p tools/out/film && rm -f tools/out/film/*.png
npx -y tsx tools/preview.ts --film
for n in 0 1 2; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=5600,3300 \
    --screenshot="$PWD/tools/out/film$n.png" "file://$PWD/tools/out/film$n.html" 2>/dev/null
  ffmpeg -y -loglevel error -i tools/out/film$n.png -vf "crop=11200:5940:0:0,untile=10x9" -start_number $((n * 90)) tools/out/film/f%04d.png
done
python3 tools/video/make_launch.py
