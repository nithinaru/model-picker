"""Measures how smoothly the ember moves across the exported product frames.

    python3 tools/video/fluidity.py <frames per second>

Each frame's coloured marks (the ember and the dot) have a centre of
brightness. A fluid ember moves that centre a similar distance every frame;
a steppy one holds still, then jumps. Reports, for the frames of the drag:
how often nothing moved, and how uneven the steps were.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'tools', 'out')
fps = float(sys.argv[1])
stride = int(sys.argv[2]) if len(sys.argv) > 2 else 1  # 2 reads every other frame
told = json.load(open(os.path.join(OUT, 'film.json')))
held = [i for i, p in enumerate(told['track']) if p['down']]
centres = []
for i in range(held[0], held[-1] + 1, stride):
    a = np.asarray(Image.open(os.path.join(OUT, 'film', f'f{i:04d}.png')).convert('RGB'), np.float32)
    colour = a.max(axis=2) - a.min(axis=2)  # grey text and dots have none; the ember and the dot do
    colour[colour < 40] = 0
    total = colour.sum()
    ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    centres.append(((xs * colour).sum() / total, (ys * colour).sum() / total) if total else (np.nan, np.nan))
c = np.array(centres)
steps = np.hypot(np.diff(c[:, 0]), np.diff(c[:, 1])) / 2  # the frames are drawn at twice size
speed = steps * fps / stride
print(f'frames in the drag: {len(c)} at {fps / stride:g} a second')
print(f'frames where the ember did not move: {100 * np.mean(steps < 0.05):.0f}%')
print(f'typical speed {np.median(speed):.0f} px/s; unevenness (spread / mean) {np.std(speed) / np.mean(speed):.2f}')
print(f'largest single-frame jump: {steps.max():.1f} px')
