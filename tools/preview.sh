#!/bin/bash
# Draws the grid's states to tools/out/preview.png (needs Google Chrome).
set -e
cd "$(dirname "$0")/.."
mkdir -p tools/out
npx -y tsx tools/preview.ts > tools/out/preview.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1500,2900 \
  --screenshot="$PWD/tools/out/preview.png" "file://$PWD/tools/out/preview.html" 2>/dev/null
echo "tools/out/preview.png"
