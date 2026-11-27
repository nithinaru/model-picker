"""Renders the launch video: picture and sound from one timeline.

    python3 tools/video/make_launch.py          -> assets/launch.mp4

Frames are drawn with Pillow in the app's own typeface; the music and sound
effects are synthesised here, so the whole film rebuilds from this file.
"""

import math
import os
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, DUR, SR = 1080, 1350, 30, 18.0, 44100
BPM = 124.0
BEAT = 60.0 / BPM
DROP = 7.0 + 12 * BEAT  # the beat drop lands on a bar line of the groove

SANS = '/Applications/Claude.app/Contents/Resources/fonts/AnthropicSans-Romans-Variable-25x258.ttf'
MONO = '/System/Library/Fonts/Menlo.ttc'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'launch.mp4')

BG = (11, 11, 10)
PANEL = (38, 38, 36)
CHIP = (58, 57, 54)
INK = (250, 249, 245)
DIM = (156, 154, 146)
QUIET = (115, 114, 108)
CLAY = (217, 119, 87)

RAMP_LEVELS = 10
CW, CH = 17, 30  # one mono cell on screen
COLS_NAMES = ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultracode']
ROW_NAMES = ['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']
# The ramp along the effort columns, as the mod draws it: blue, grey, yellow, orange, purple.
COL_INK = ['#4F8FDB', '#8C8A82', '#E0B93A', '#E8962A', '#E2701F', '#D97757', '#8E82E6']

_fonts = {}


def font(path, size, index=0):
    key = (path, size, index)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size, index=index)
    return _fonts[key]


def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def ease_out_cubic(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def ease_out_back(x):
    x = max(0.0, min(1.0, x))
    c1 = 1.70158
    return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2


def col_ink(c):
    c = max(0.0, min(len(COL_INK) - 1.0, c))
    i = int(math.floor(c))
    j = min(len(COL_INK) - 1, i + 1)
    return mix(hx(COL_INK[i]), hx(COL_INK[j]), c - i)


def make_text(text, face, colour, pad=8):
    """A transparent sprite of one line of text, to scale, fade and pop."""
    probe = ImageDraw.Draw(Image.new('RGB', (4, 4)))
    left, top, right, bottom = probe.textbbox((0, 0), text, font=face)
    spr = Image.new('RGBA', (right - left + 2 * pad, bottom - top + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(spr).text((pad - left, pad - top), text, font=face, fill=tuple(colour) + (255,))
    return spr


def make_pill(w, h, fill, radius, stroke=None):
    spr = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(spr).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=tuple(fill) + (255,),
                                          outline=tuple(stroke) + (255,) if stroke else None, width=2)
    return spr


def paste(img, spr, cx, cy, scale=1.0, alpha=1.0):
    if alpha <= 0.0 or scale <= 0.02:
        return
    w, h = spr.size
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    s = spr.resize((nw, nh), Image.LANCZOS) if (nw, nh) != (w, h) else spr
    if alpha < 1.0:
        s = s.copy()
        s.putalpha(s.split()[3].point(lambda v: int(v * alpha)))
    img.paste(s.convert('RGB'), (int(cx - nw / 2), int(cy - nh / 2)), s.split()[3])


def text_at(img, text, face, colour, cx, cy, scale=1.0, alpha=1.0):
    paste(img, make_text(text, face, colour), cx, cy, scale, alpha)


# ---------------------------------------------------------------- the ember

RAMP = ' .:-=+*#%@'


def glyph(level, dx, dy):
    """The mark a level of the ember wears, as the mod draws it."""
    if level <= 0:
        return '.'
    if level == 1:
        return ':'
    if level >= 8:
        return '#'
    if level == 7:
        return '*'
    if level == 6:
        return '+'
    ax, ay = abs(dx), abs(dy)
    if ay < ax * 0.45:
        return '=' if level >= 4 else '-'
    if ax < ay * 0.45:
        return '|' if level >= 3 else "'"
    if level == 2:
        return '~'
    if level == 5:
        return 'x'
    return '/' if (dx > 0) == (dy < 0) else '\\'


def noise01(c, r, t):
    v = math.sin(c * 12.9898 + r * 78.233 + math.floor(t * 9) * 37.719) * 43758.5453
    return v - math.floor(v)


def ember(d, x0, y0, cols, rows, sources, ink_of, t, reach, dark=BG, swirl=0.0):
    """Draws the ASCII ember: `sources` are (x, y, strength) points in pixels.

    Each character's heat is the strongest source's glow there, so a trail is
    just several sources along the dot's recent path.
    """
    for r in range(rows):
        for c in range(cols):
            px = x0 + c * CW
            py = y0 + r * CH
            heat = 0.0
            best = None
            for sx, sy, s in sources:
                dist = math.hypot((px - sx) / CW, (py - sy) / CW)
                g = max(0.0, 1 - dist / reach) ** 1.25 * s
                if g > heat:
                    heat = g
                    best = (sx, sy)
            if heat <= 0.07 or best is None:
                continue
            if swirl:
                # Arms that turn about the dot, so the marks move as it grows.
                ang = math.atan2(py - best[1], px - best[0])
                rad = math.hypot(px - best[0], py - best[1]) / CW
                heat = max(0.0, min(1.0, heat * (1 + swirl * math.sin(3 * ang + rad * 0.55 - t * 5.0))))
                if heat <= 0.07:
                    continue
            heat *= 0.9 + 0.1 * noise01(c, r, t)
            level = min(RAMP_LEVELS - 1, int(heat * RAMP_LEVELS))
            dx = (px - best[0]) / CW
            dy = (py - best[1]) / CW
            ink = ink_of(heat)
            colour = mix(dark, ink, 0.3 + 0.7 * heat)
            if heat > 0.85:
                colour = mix(colour, (255, 241, 220), (heat - 0.85) / 0.15 * 0.6)
            d.text((px, py), glyph(level, dx, dy), font=font(MONO, 28), fill=colour, anchor='lt')


# ------------------------------------------------------------------ scenes

WIN = (90, 170, 990, 1180)


def window(img):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(WIN, radius=36, fill=PANEL)
    d.text((130, 205), 'Claude Code', font=font(SANS, 26), fill=DIM, anchor='lm')
    for i, x in enumerate((960, 938, 916)):
        d.ellipse((x - 7, 198, x + 7, 212), fill=QUIET)
    return d


def scene_hook(t):
    """The opening: a dot already burning, growing as its ASCII turns, then opening into the window."""
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    cx, cy = 540, 640
    g = 0.45 + 0.55 * ease_out_cubic(t / 1.9)
    ember(d, cx - 31 * CW, cy - 21 * CH, 63, 43, [(cx, cy, 1.0)],
          lambda h: mix(hx('#FFE9A8'), hx('#E2701F'), h ** 0.7), t, reach=10 + 12 * g, swirl=0.45)
    k = smooth((t - 1.9) / 0.7)
    rad = 30 + 95 * g + 1100 * k * k
    d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=mix(hx('#F08A3C'), PANEL, k))
    if k < 0.3:
        lit = rad * 0.45
        d.ellipse((cx - rad * 0.2 - lit, cy - rad * 0.25 - lit, cx - rad * 0.2 + lit, cy - rad * 0.25 + lit),
                  fill=mix(hx('#FFC38A'), hx('#F08A3C'), k / 0.3))
    return img


def prompt_y(t):
    return 640 + (930 - 640) * ease_out_cubic((t - 3.9) / 0.6)


def scene_claude(t):
    """A blank Claude Code window, the Fable chip popping and going, the prompt sliding down, the task bar."""
    img = Image.new('RGB', (W, H), BG)
    d = window(img)
    py = prompt_y(t)
    d.rounded_rectangle((130, py - 60, 950, py + 60), radius=30, fill=CHIP)
    text_at(img, 'Ask Claude', font(SANS, 34), QUIET, 262, py, alpha=1.0)
    # The Fable chip: a cloud that pops in, holds, and bursts away.
    if 3.0 <= t < 4.1:
        if t < 3.35:
            s, a = ease_out_back((t - 3.0) / 0.35), 1.0
        elif t < 3.7:
            s, a = 1.0, 1.0
        else:
            k = (t - 3.7) / 0.4
            s, a = 1.0 + 0.4 * k, 1 - k
        chip = make_pill(430, 140, (64, 63, 60), 70)
        text = make_text('Fable 5.2 · Medium', font(SANS, 38), INK)
        cloud = Image.new('RGBA', chip.size, (0, 0, 0, 0))
        cloud.alpha_composite(chip)
        tw, th = text.size
        cloud.alpha_composite(text, ((chip.size[0] - tw) // 2, (chip.size[1] - th) // 2))
        paste(img, cloud, 540, 470, scale=s, alpha=a)
    if 3.7 <= t < 4.2:
        k = (t - 3.7) / 0.5
        for i in range(18):
            ang = i * 2 * math.pi / 18
            rad = 40 + 220 * ease_out_cubic(k)
            x = 540 + rad * math.cos(ang)
            y = 470 + rad * 0.5 * math.sin(ang)
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=mix(BG, CLAY, 1 - k))
    if t >= 4.5:
        s = ease_out_back((t - 4.5) / 0.35)
        pill = make_pill(800, 96, (50, 49, 46), 48)
        pill_img = Image.new('RGBA', pill.size, (0, 0, 0, 0))
        pill_img.alpha_composite(pill)
        ImageDraw.Draw(pill_img).ellipse((38, 38, 58, 58), fill=CLAY + (255,))
        pill_img.alpha_composite(make_text('model-picker', font(SANS, 34), INK), (72, 28))
        pill_img.alpha_composite(make_text('Pick model', font(SANS, 30), CLAY), (560, 30))
        paste(img, pill_img, 540, 1112, scale=s)
    return img


def dot_path(t):
    keys = [(7.0, 0, 0), (7.6, 1, 0), (8.2, 2, 0), (8.8, 3, 0), (9.4, 4, 0), (10.0, 5, 0),
            (10.6, 6, 0), (11.2, 6, 1), (11.8, 4, 2), (12.4, 3, 2)]
    if t <= keys[0][0]:
        return keys[0][1], keys[0][2]
    for (t0, c0, r0), (t1, c1, r1) in zip(keys, keys[1:]):
        if t <= t1:
            f = smooth((t - t0) / (t1 - t0))
            return c0 + (c1 - c0) * f, r0 + (r1 - r0) * f
    return keys[-1][1], keys[-1][2]


def cell_xy(c, r):
    return 300 + c * 96, 450 + r * 175


def scene_grid(t):
    img = Image.new('RGB', (W, H), BG)
    d = window(img)
    d.text((130, 262), 'model-picker', font=font(SANS, 28), fill=INK, anchor='lm')
    # Effort names across the top, the model names down the side.
    for c, name in enumerate(COLS_NAMES):
        d.text((cell_xy(c, 0)[0], 340), name, font=font(SANS, 22), fill=DIM, anchor='mm')
    for r, name in enumerate(ROW_NAMES):
        d.text((130, cell_xy(0, r)[1]), name, font=font(SANS, 26), fill=DIM, anchor='lm')
    dc, dr = dot_path(t)
    for c in range(7):
        for r in range(4):
            x, y = cell_xy(c, r)
            allowed = (r == 0 or r == 1) or (r == 2 and c <= 3) or (r == 3 and c == 0)
            colour = QUIET if allowed else (60, 59, 56)
            d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=colour)
    # The ember follows the dot: the head glows, a trail of earlier positions streaks behind.
    sources = []
    px_now = None
    for k, back in enumerate((0.0, 0.07, 0.14, 0.21, 0.28)):
        c, r = dot_path(max(7.0, t - back))
        x, y = cell_xy(c, r)
        if k == 0:
            px_now = (x, y)
        sources.append((x, y, 0.95 * (0.7 ** k)))
    speed = math.hypot(cell_xy(*dot_path(t))[0] - cell_xy(*dot_path(max(7.0, t - 0.07)))[0],
                       cell_xy(*dot_path(t))[1] - cell_xy(*dot_path(max(7.0, t - 0.07)))[1]) / 0.07
    energy = min(1.0, speed / 700)
    reach = 7.6 * (1 + 0.1 * energy)
    ink = col_ink(dc)
    if t >= 7.0:
        ember(d, 150, 372, 48, 25, sources, lambda h: mix(ink, (255, 241, 220), (h - 0.6) * 0.4 if h > 0.6 else 0),
              t, reach=reach, dark=PANEL)
    # The picked dot, larger, in the effort's colour.
    if px_now is not None and t >= 7.0:
        d.ellipse((px_now[0] - 18, px_now[1] - 18, px_now[0] + 18, px_now[1] + 18), fill=ink)
    # The big effort name under the window, following the dot.
    col_i = int(round(dc))
    text_at(img, COLS_NAMES[min(6, max(0, col_i))], font(SANS, 64), col_ink(dc), 540, 1262,
            alpha=smooth((t - 6.9) / 0.4) * (1 - smooth((t - 13.0) / 0.2)))
    return img


def scene_end(t):
    img = Image.new('RGB', (W, H), BG)
    grow = 0.7 + 0.3 * ease_out_cubic((t - 15.8) / 0.6)
    cx, cy = 540, 360
    ember(ImageDraw.Draw(img), cx - 26 * CW, cy - 7 * CH, 52, 14, [(cx, cy, 1.0)],
          lambda h: mix(hx('#E2701F'), hx('#FFF1DC'), h), t, reach=8 * grow)
    text_at(img, 'model-picker', font(SANS, 118), INK, 540, 610, scale=0.9 + 0.1 * ease_out_back((t - 15.8) / 0.4),
            alpha=smooth((t - 15.8) / 0.3))
    text_at(img, '/plugin install model-picker', font(MONO, 34), DIM, 540, 790, alpha=smooth((t - 16.3) / 0.4))
    text_at(img, '--marketplace nithinaru/model-picker', font(MONO, 34), DIM, 540, 842, alpha=smooth((t - 16.5) / 0.4))
    return img


def frame(t):
    if t < 2.6:
        a = smooth((t - 2.15) / 0.45)
        return Image.blend(scene_hook(t), scene_claude(2.6), a) if a > 0 else scene_hook(t)
    if t < 6.2:
        img = scene_claude(t)
    elif t < 7.0:
        a = smooth((t - 6.3) / 0.7)
        img = Image.blend(scene_claude(6.2), scene_grid(7.0), a)
    elif t < 15.6:
        img = scene_grid(t)
    else:
        img = scene_end(t)
    if t >= DROP:
        # The drop: the grid kicks outward once and settles, with a flash that dies in a fifth of a second.
        k = t - DROP
        if k < 1.6:
            scale = 1 + 0.035 * math.exp(-k * 7)
            img = img.resize((int(W * scale), int(H * scale)), Image.BILINEAR)
            x0 = (img.size[0] - W) // 2
            y0 = (img.size[1] - H) // 2
            img = img.crop((x0, y0, x0 + W, y0 + H))
        flash = math.exp(-k * 14) * 0.45
        if flash > 0.01:
            img = Image.blend(img, Image.new('RGB', (W, H), (255, 246, 232)), flash)
        if 13.2 <= t < 15.6:
            text_at(img, 'pick. drag. feel the effort.', font(SANS, 58), INK, 540, 1262,
                    scale=1.0 + 0.3 * (1 - ease_out_back((t - 13.2) / 0.25)) if t < 13.45 else 1.0)
    if t >= 15.6:
        fade = smooth((t - 15.6) / 0.4)
        if fade < 1:
            img = Image.blend(img, Image.new('RGB', (W, H), BG), 0)  # keep the end card
    return img


# ------------------------------------------------------------------- sound

def lowpass_sweep(x, a0, a1):
    a = np.linspace(a0, a1, len(x))
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s)
        y[i] = s
    return y


def tau_of(n):
    return np.arange(n) / SR


def kick():
    tau = tau_of(int(0.45 * SR))
    phase = 2 * np.pi * (48 * tau + 75 * (1 - np.exp(-38 * tau)) / 38)
    return np.sin(phase) * np.exp(-8 * tau) * 0.95


def hat(seed):
    rng = np.random.default_rng(seed)
    n = int(0.05 * SR)
    tau = tau_of(n)
    x = rng.uniform(-1, 1, n)
    return np.diff(np.concatenate([[0.0], x])) * np.exp(-75 * tau) * 0.18


def bass(f, dur):
    n = int(dur * SR)
    tau = tau_of(n)
    return (np.sin(2 * np.pi * f * tau) + 0.35 * np.sin(4 * np.pi * f * tau)) * np.exp(-2.2 * tau) * \
        0.3 * (1 - np.exp(-tau * 200))


def chord(freqs, dur):
    n = int(dur * SR)
    tau = tau_of(n)
    env = np.minimum(1, tau / 0.15) * np.exp(-0.5 * tau)
    return sum(np.sin(2 * np.pi * f * tau) for f in freqs) * env * 0.06


def pop(strength=0.55, rise=300.0):
    tau = tau_of(int(0.25 * SR))
    phase = 2 * np.pi * (rise * tau + 2 * rise * (1 - np.exp(-40 * tau)) / 40)
    return np.sin(phase) * np.exp(-18 * tau) * strength


def poof():
    rng = np.random.default_rng(3)
    n = int(0.35 * SR)
    tau = tau_of(n)
    return lowpass_sweep(rng.uniform(-1, 1, n), 0.15, 0.15) * np.exp(-9 * tau) * 0.5


def tick():
    tau = tau_of(int(0.03 * SR))
    return np.sin(2 * np.pi * 2400 * tau) * np.exp(-160 * tau) * 0.22


def whoosh(dur, up=True, gain=0.7):
    rng = np.random.default_rng(11)
    n = int(dur * SR)
    tau = tau_of(n)
    a0, a1 = (0.02, 0.3) if up else (0.3, 0.02)
    y = lowpass_sweep(rng.uniform(-1, 1, n), a0, a1)
    return y * np.sin(np.pi * tau / dur) ** 1.5 * gain


def riser(dur):
    rng = np.random.default_rng(5)
    n = int(dur * SR)
    tau = tau_of(n)
    y = lowpass_sweep(rng.uniform(-1, 1, n), 0.01, 0.35)
    return y * (tau / dur) ** 1.6 * 0.3


def crash():
    rng = np.random.default_rng(9)
    n = int(2.2 * SR)
    tau = tau_of(n)
    x = rng.uniform(-1, 1, n)
    return np.diff(np.concatenate([[0.0], x])) * np.exp(-1.6 * tau) * 0.3


def slam():
    tau = tau_of(int(0.9 * SR))
    phase = 2 * np.pi * (45 * tau + 70 * (1 - np.exp(-25 * tau)) / 25)
    return np.sin(phase) * np.exp(-4 * tau) * 0.9


def build_audio(path):
    N = int((DUR + 0.5) * SR)
    buf = np.zeros(N)

    def add(t, sig, gain=1.0):
        i = int(t * SR)
        n = min(len(sig), N - i)
        if n > 0 and i >= 0:
            buf[i:i + n] += sig[:n] * gain

    def cr(t):
        return max(0.0, min(1.0, (t - 6.0) / (DROP - 6.0))) ** 1.6 if t < DROP else 1.0

    # Sound effects.
    add(0.0, pop(0.5, 240))
    add(0.0, whoosh(1.9, up=True, gain=0.35))
    add(1.9, whoosh(0.7, up=False, gain=0.6))
    add(3.0, pop(0.6, 340))
    add(3.7, poof())
    add(3.9, whoosh(0.45, up=False, gain=0.5))
    add(4.5, pop(0.55, 380))
    add(6.1, whoosh(0.9, up=True, gain=0.8))
    for t in (7.6, 8.2, 8.8, 9.4, 10.0, 10.6, 11.2, 11.8, 12.4):
        add(t, tick(), 0.9)
    add(15.8, pop(0.7, 300))
    add(16.3, pop(0.35, 600))

    # The groove: a riser and pads from 6 seconds, drums and bass from 7.
    add(6.0, riser(DROP - 6.0))
    bar = 4 * BEAT
    chords = [(220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (130.8, 164.8, 196.0), (196.0, 246.9, 293.7)]
    for b in range(int((DUR - 6.0) / bar) + 1):
        t = 6.0 + b * bar
        if t >= DUR - 1.0:
            break
        add(t, chord(chords[b % 4], bar + 0.2), 0.5 + 0.5 * cr(t))
    for j in range(int((DUR - 6.0) / (BEAT / 2)) + 1):
        t = 6.0 + j * BEAT / 2
        if t >= DUR - 2.0:
            break
        add(t, hat(j), 0.4 + 0.6 * cr(t))
    notes = [55.0, 55.0, 65.41, 55.0, 43.65, 49.0, 41.2, 49.0]
    k = 0
    while True:
        t = 7.0 + k * BEAT
        if t >= DUR - 2.4:
            break
        if t < DROP - 0.02 or t >= DROP:
            add(t, kick(), 0.9 if t < DROP else 1.1)
        add(t, bass(notes[k % 8], BEAT * 0.45), 0.4 + 0.6 * cr(t))
        k += 1
    # The drop itself.
    add(DROP, crash())
    add(DROP, kick(), 1.2)
    add(DROP + 0.02, slam(), 0.8)

    # The silence before the drop, and the fade out at the end.
    buf *= 1.0
    gap0, gap1 = DROP - 0.16, DROP
    buf[int(gap0 * SR):int(gap1 * SR)] *= 0.12
    fade0 = 16.8
    fade = np.ones(N)
    fi = int(fade0 * SR)
    fade[fi:] = np.linspace(1.0, 0.0, N - fi)
    buf *= fade
    buf = np.tanh(buf * 1.1) * 0.85
    pcm = (buf[:int(DUR * SR)] * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.column_stack([pcm, pcm]).tobytes())


def main():
    wav = '/tmp/model_picker_launch.wav'
    build_audio(wav)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    total = int(DUR * FPS)
    ff = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-i', wav,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT,
    ], stdin=subprocess.PIPE)
    for i in range(total):
        img = frame(i / FPS)
        ff.stdin.write(img.tobytes())
    ff.stdin.close()
    ff.wait()
    print(OUT)


if __name__ == '__main__':
    main()
