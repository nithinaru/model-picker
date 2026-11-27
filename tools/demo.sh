#!/bin/bash
# Builds assets/demo.gif from the grid's own drawing code (needs Chrome, ffmpeg).
set -e
cd "$(dirname "$0")/.."
mkdir -p tools/out assets
npx -y tsx tools/preview.ts --demo > tools/out/demo.html
N=$(grep -o 'data-frames="[0-9]*"' tools/out/demo.html | grep -o '[0-9]*')
ROWS=$(( (N + 9) / 10 ))
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1.5 --window-size=5600,$((ROWS * 352)) \
  --screenshot="$PWD/tools/out/demo.png" "file://$PWD/tools/out/demo.html" 2>/dev/null
ffmpeg -y -loglevel error -i tools/out/demo.png -frames:v "$N" \
  -vf "untile=10x${ROWS},setpts=N/14/TB,scale=840:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none" \
  -r 14 assets/demo.gif
echo "assets/demo.gif ($N frames)"
