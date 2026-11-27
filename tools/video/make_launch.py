"""Renders the launch video: picture and sound from one timeline.

    npx tsx tools/preview.ts --film   (then screenshot and split the pages: see tools/video/film.sh)
    python3 tools/video/make_launch.py          -> assets/launch.mp4

The grid on screen is the mod's own drawing: frames exported by
tools/preview.ts from hooks/grid.tsx, driven by a scripted cursor. This file
places them in a dark Claude Code window and films it the way a screen
recording is edited: a cursor, zooms that follow it, and cuts. The music and
sound effects are synthesised here.
"""

import json
import math
import os
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, DUR, SR = 1920, 1080, 60, 15.0, 44100
GRID_T0 = 5.2  # when the grid's own frames start playing
GRID_END = 12.0  # when the camera leaves the grid
BPM = 124.0
BEAT = 60.0 / BPM
DROP = GRID_T0 + 3.6  # set from the film: the drop lands as the dot reaches Ultracode

SANS = '/Applications/Claude.app/Contents/Resources/fonts'
MONO = '/System/Library/Fonts/Menlo.ttc'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = os.path.join(ROOT, 'tools', 'out')
OUT = os.path.join(ROOT, 'assets', 'launch.mp4')

BG = (11, 11, 10)
WW, WH, S = 1440, 900, 2  # the app window, and how many pixels a point of it gets
VIEW = (168, 45, 1584, 990)  # where the recording sits in the picture
PANE_W = 620
GRID_AT = (24, 72)  # the grid inside the pane
INK = (250, 249, 245)
DIM = (156, 154, 146)

_fonts = {}


def font(path, size):
    if (path, size) not in _fonts:
        _fonts[(path, size)] = ImageFont.truetype(path, size)
    return _fonts[(path, size)]


def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def back(x):
    x = max(0.0, min(1.0, x))
    return 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2


def paste(img, spr, cx, cy, scale=1.0, alpha=1.0):
    """Pastes an RGBA sprite centred on a point, scaled and faded."""
    if alpha <= 0.0 or scale <= 0.02:
        return
    w, h = spr.size
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    s = spr.resize((nw, nh), Image.LANCZOS) if (nw, nh) != (w, h) else spr
    a = s.split()[3]
    if alpha < 1.0:
        a = a.point(lambda v: int(v * alpha))
    img.paste(s.convert('RGB'), (int(cx - nw / 2), int(cy - nh / 2)), a)


# ------------------------------------------------------------- the window

SHEET = f"""<!doctype html><meta charset="utf-8"><style>
@font-face {{ font-family: 'Anthropic Sans'; font-weight: 300 800; src: url('file://{SANS}/AnthropicSans-Romans-Variable-25x258.ttf'); }}
body {{ margin: 0; font: 14px/20px 'Anthropic Sans', -apple-system, sans-serif; color: #FAF9F5; background: transparent; }}
.a {{ position: absolute; box-sizing: border-box; }}
.bar {{ height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 1px solid rgba(222,220,209,.12); }}
.dot {{ width: 12px; height: 12px; border-radius: 6px; }}
.ic {{ width: 15px; height: 15px; border: 1.5px solid #9C9A92; border-radius: 4px; }}
.ring {{ width: 16px; height: 16px; border-radius: 8px; background: conic-gradient(#3987E5 0 24%, #5C5B57 0); -webkit-mask: radial-gradient(circle, transparent 5px, #000 5.6px); }}
.auto {{ display: flex; align-items: center; gap: 10px; font-size: 13px; color: #C2C0B6; }}
</style>
<div class="a" style="left:0;top:0;width:1440px;height:900px;background:#262624">
  <div class="bar"><div class="dot" style="background:#FF5F57"></div><div class="dot" style="background:#FEBC2E"></div><div class="dot" style="background:#28C840"></div>
    <div style="margin-left:14px;font-weight:500">model-picker</div><div style="color:#9C9A92">~/Downloads/CODE</div>
    <div style="margin-left:auto;display:flex;gap:16px;align-items:center;color:#C2C0B6"><div class="ic"></div><div class="ic" style="border-radius:8px"></div><div class="ic"></div><div>Share</div></div></div>
</div>
<div class="a" style="left:0;top:920px;width:760px;height:56px;border-radius:16px;background:#30302E;border:1px solid rgba(222,220,209,.18);display:flex;align-items:center;padding:0 18px;gap:14px;font-size:15px">
  <div style="font-size:22px;color:#C2C0B6;font-weight:300">+</div><div style="color:#9C9A92">Type / for commands</div><div class="ic" style="margin-left:auto;border-radius:8px;width:13px;height:18px"></div></div>
<div class="a" style="left:800px;top:920px;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-radius:8px;background:#3A3936;font-size:13px"><span style="font-weight:500">Fable 5.2</span><span style="color:#9C9A92">Medium</span></div>
<div class="a" style="left:0;top:1000px;width:760px;height:44px;border-radius:12px;background:#30302E;display:flex;align-items:center;padding:0 8px">
  <div style="padding:4px 10px;border-radius:8px;background:#45443F;font-size:13px">Pick model</div>
  <div class="auto" style="margin-left:auto;padding-right:6px"><span>Auto</span><div class="ring"></div></div></div>
<div class="a auto" style="left:1000px;top:920px;height:30px"><span>Auto</span><div class="ring"></div></div>
<div class="a" style="left:1500px;top:0;width:620px;height:900px;background:#262624;border-left:1px solid rgba(222,220,209,.14)">
  <div class="bar"><div style="font-weight:500">Model picker</div><div style="margin-left:auto;display:flex;gap:14px"><div class="ic"></div><div class="ic" style="border-radius:8px"></div></div></div></div>
"""


def sprites():
    """The window's parts, drawn once by Chrome and cut from one sheet."""
    page = os.path.join(TMP, 'sheet.html')
    shot = os.path.join(TMP, 'sheet.png')
    open(page, 'w').write(SHEET)
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--force-device-scale-factor={S}',
                    '--default-background-color=00000000', '--window-size=2200,1100', f'--screenshot={shot}',
                    f'file://{page}'], stderr=subprocess.DEVNULL, check=True)
    sheet = Image.open(shot).convert('RGBA')
    cut = lambda x, y, w, h: sheet.crop((x * S, y * S, (x + w) * S, (y + h) * S))
    return {'base': cut(0, 0, 1440, 900).convert('RGB'), 'prompt': cut(0, 920, 760, 56), 'chip': cut(800, 920, 150, 30),
            'band': cut(0, 1000, 760, 44), 'auto': cut(1000, 920, 64, 30), 'pane': cut(1500, 0, 620, 900).convert('RGB')}


def cursor_sprite():
    """The macOS arrow: black, edged in white, with a soft shadow. Returns it and where its tip is."""
    k = 1.25 * S * 4  # drawn four times too large, then reduced, for a clean edge
    at = lambda points, dx=0.0, dy=0.0: [((x - 6 + dx) * k, (y - 3 + dy) * k) for x, y in points]
    edge = [[(8.2, 20.9), (8.2, 4.9), (19.8, 16.5), (13, 16.5), (12.6, 16.6)], [(17.3, 21.6), (13.7, 23.1), (9, 12), (12.7, 10.5)]]
    arrow = [(9.2, 7.3), (9.2, 18.5), (12.2, 15.6), (12.6, 15.5), (17.4, 15.5)]
    tail = [(0.9221 * x + 0.3871 * y - 5.7605, -0.3871 * x + 0.9221 * y + 6.5909)
            for x, y in [(12.5, 13.6), (14.5, 13.6), (14.5, 21.6), (12.5, 21.6)]]
    spr = Image.new('RGBA', (int(18 * k), int(25 * k)), (0, 0, 0, 0))
    d = ImageDraw.Draw(spr)
    for poly in edge:
        d.polygon(at(poly, 0.5, 1.1), fill=(0, 0, 0, 120))
    spr = spr.filter(ImageFilter.GaussianBlur(k * 0.7))
    d = ImageDraw.Draw(spr)
    for poly in edge:
        d.polygon(at(poly), fill=(255, 255, 255, 255))
    d.polygon(at(arrow), fill=(0, 0, 0, 255))
    d.polygon(at(tail), fill=(0, 0, 0, 255))
    spr = spr.resize((spr.size[0] // 4, spr.size[1] // 4), Image.LANCZOS)
    return spr, (int((8.2 - 6) * k / 4), int((4.9 - 3) * k / 4))


def key(keys, t):
    """A value eased between timed keys: each key is (time, *values)."""
    if t <= keys[0][0]:
        return keys[0][1:]
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            f = smooth((t - a[0]) / (b[0] - a[0]))
            return tuple(a[i] + (b[i] - a[i]) * f for i in range(1, len(a)))
    return keys[-1][1:]


CLICKS = [4.4]
CAM = [(0, 1.0, 720, 450), (1.9, 1.0, 720, 450), (2.3, 2.3, 960, 740), (2.95, 2.3, 960, 740), (3.5, 1.7, 700, 690),
       (4.4, 1.7, 700, 690), (4.95, 1.2, 820, 450), (5.6, 2.1, 1104, 206), (GRID_END, 2.1, 1104, 206),
       (GRID_END + 0.6, 1.0, 720, 450), (DUR, 1.0, 720, 450)]
MOUSE = [(0, 980, 560), (1.9, 1100, 810), (2.9, 1100, 810), (3.7, 640, 610), (4.3, 397, 680), (4.55, 397, 680), (GRID_T0, 700, 600)]


class Film:
    def __init__(self):
        self.spr = sprites()
        self.cursor, self.tip = cursor_sprite()
        told = json.load(open(os.path.join(TMP, 'film.json')))
        self.track = told['track']
        global DROP
        DROP = GRID_T0 + told['drop']
        CLICKS[1:] = [GRID_T0 + d for d in told['downs']]
        self.tiles = {}
        stage = Image.new('RGB', (W, H), (18, 18, 17))
        glow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(glow).ellipse((300, -500, 1620, 700), fill=70)
        stage.paste((70, 40, 28), mask=glow.filter(ImageFilter.GaussianBlur(220)))
        x, y, w, h = VIEW
        shadow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((x, y + 18, x + w, y + h + 18), radius=22, fill=150)
        stage.paste((0, 0, 0), mask=shadow.filter(ImageFilter.GaussianBlur(28)))
        self.stage = stage
        self.mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(self.mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=22, fill=255)

    def tile(self, i):
        i = max(0, min(len(self.track) - 1, i))
        if i not in self.tiles:
            self.tiles = {i: Image.open(os.path.join(TMP, 'film', f'f{i:04d}.png')).convert('RGB')}
        return self.tiles[i]

    def mouse(self, t):
        if t < GRID_T0:
            x, y = key(MOUSE, t)
            return x + 0.8 * math.sin(t * 7.3) + 0.4 * math.sin(t * 13.1 + 1.7), y + 0.6 * math.sin(t * 6.1 + 0.9)
        p = self.track[max(0, min(len(self.track) - 1, int((t - GRID_T0) * FPS)))]
        return WW - PANE_W + GRID_AT[0] + p['x'], GRID_AT[1] + p['y']

    def window(self, t):
        """The app window at a moment, at twice its size."""
        img = self.spr['base'].copy()
        d = ImageDraw.Draw(img)
        open_ = smooth((t - 4.55) / 0.55)
        col = WW - PANE_W * open_
        px = (col - 760) / 2
        py = 680 + 30 * smooth((t - 3.2) / 0.5)
        img.paste(self.spr['prompt'], (int(px * S), int(py * S)), self.spr['prompt'])
        # The app's own model chip: it swells into a puff of cloud and is gone.
        cx, cy = px + 760 - 64 - 14 - 75, 759
        # The app's Auto and usage ring sit beside the chip, and move into the mod's row when it arrives.
        if t < 3.5:
            paste(img, self.spr['auto'], (px + 760 - 32) * S, cy * S, 1.0, 1 - smooth((t - 3.15) / 0.3))
        if t < 2.9:
            grow = 1 + 0.3 * back((t - 2.3) / 0.2) if t >= 2.3 else 1.0
            gone = smooth((t - 2.5) / 0.35)
            paste(img, self.spr['chip'], cx * S, cy * S, grow + 0.5 * gone, 1 - gone)
        if 2.45 <= t < 3.2:
            k = (t - 2.45) / 0.75
            for i in range(9):
                ang = i * 2 * math.pi / 9 + 0.3
                r = (26 + 46 * smooth(k * 1.4)) * (0.8 + 0.4 * ((i * 7) % 5) / 4)
                size = (20 + 8 * (i % 3)) * (1 - 0.4 * k)
                x, y = (cx + r * math.cos(ang) * 1.5) * S, (cy + r * math.sin(ang) * 0.7) * S
                d.ellipse((x - size * S / 2, y - size * S / 2, x + size * S / 2, y + size * S / 2),
                          fill=mix((38, 38, 36), (150, 148, 140), (1 - k) ** 1.5))
        # The mod's row above the prompt, popping in.
        if t >= 3.6:
            paste(img, self.spr['band'], (px + 380) * S, (py - 30) * S, 0.6 + 0.4 * back((t - 3.6) / 0.3))
        if open_ > 0:
            img.paste(self.spr['pane'], (int(col * S), 0))
            img.paste(self.tile(int((t - GRID_T0) * FPS)), (int((col + GRID_AT[0]) * S), GRID_AT[1] * S))
        mx, my = self.mouse(t)
        for at in CLICKS:
            k = (t - at) / 0.4
            if 0 <= k < 1:
                r = (6 + 26 * smooth(k)) * S
                d.ellipse((mx * S - r, my * S - r, mx * S + r, my * S + r), outline=mix((38, 38, 36), INK, 1 - k), width=3 * S)
        img.paste(self.cursor, (int(mx * S) - self.tip[0], int(my * S) - self.tip[1]), self.cursor)
        return img

    def shot(self, t):
        """The window as the camera sees it: zoomed toward what matters, in its frame on the stage."""
        z, fx, fy = key(CAM, t)
        if 5.6 <= t <= GRID_END:
            mx, my = self.mouse(t)
            follow = 0.28 * smooth((t - 5.6) / 0.6) * (1 - smooth((t - GRID_END + 0.5) / 0.5))
            fx, fy = fx + (mx - fx) * follow, fy + (my - fy) * follow
        vw, vh = WW / z, WH / z
        x0 = max(0, min(WW - vw, fx - vw / 2))
        y0 = max(0, min(WH - vh, fy - vh / 2))
        view = self.window(t).resize(VIEW[2:], Image.BICUBIC, box=(x0 * S, y0 * S, (x0 + vw) * S, (y0 + vh) * S))
        out = self.stage.copy()
        out.paste(view, VIEW[:2], self.mask)
        return out


# ------------------------------------------------------------ the opening

# The opening and closing marks are worked out for every character cell at
# once, and each frame is the average of several moments inside it, so a mark
# that changes fades into the next instead of snapping.
CELL_W, CELL_H, GLYPH_PT = 13, 24, 22
GLYPHS = " .:'-~=|/\\x+*#"
GID = {ch: i for i, ch in enumerate(GLYPHS)}
ROWS_N, COLS_N = H // CELL_H + 1, W // CELL_W + 1
XS = (np.arange(COLS_N) * CELL_W + CELL_W / 2)[None, :].repeat(ROWS_N, 0)
YS = (np.arange(ROWS_N) * CELL_H + CELL_H / 2)[:, None].repeat(COLS_N, 1)
PALE = np.array(hx('#FFE9A8'), np.float32)
HOT = np.array(hx('#E2701F'), np.float32)
CREAM = np.array(hx('#FFF1DC'), np.float32)
BGV = np.array(BG, np.float32)
UNIT = 16.0  # the pattern's own unit of length, in pixels
_masks = None


def masks():
    """Each mark as a cell-sized stencil."""
    global _masks
    if _masks is None:
        _masks = np.zeros((len(GLYPHS), CELL_H, CELL_W), np.float32)
        for i, ch in enumerate(GLYPHS):
            if ch != ' ':
                cell = Image.new('L', (CELL_W, CELL_H), 0)
                ImageDraw.Draw(cell).text((CELL_W / 2, CELL_H / 2), ch, font=font(MONO, GLYPH_PT), fill=255, anchor='mm')
                _masks[i] = np.asarray(cell, np.float32) / 255
    return _masks


def field(t, cx, cy, reach, core, ring=None, ring_gain=0.0):
    """The heat of every cell: a turning ember about a point, and a ring of marks at a radius (lengths in pixels)."""
    dx = (XS - cx) / UNIT
    dy = (YS - cy) / UNIT
    dist = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    heat = np.clip(1 - dist / (reach / UNIT), 0, None) ** 1.1 * (1 + 0.5 * np.sin(3 * ang + dist * 0.55 - t * 5)) * core
    if ring is not None:
        heat = np.maximum(heat, np.exp(-((dist - ring / UNIT) / 4.5) ** 2) * (1 + 0.4 * np.sin(5 * ang - t * 6)) * ring_gain)
    return np.clip(heat, 0, 1), dx, dy


def layer(heat, dx, dy):
    """The marks for a field of heat: their colour times their cover, and their cover."""
    level = np.minimum(9, (heat * 10).astype(np.int32))
    ax, ay = np.abs(dx), np.abs(dy)
    flat, tall = ay < ax * 0.45, ax < ay * 0.45
    ids = np.select(
        [heat <= 0.07, level <= 0, level == 1, level >= 8, level == 7, level == 6, flat & (level >= 4), flat,
         tall & (level >= 3), tall, level == 2, level == 5, (dx > 0) == (dy < 0)],
        [GID[' '], GID['.'], GID[':'], GID['#'], GID['*'], GID['+'], GID['='], GID['-'], GID['|'], GID["'"], GID['~'],
         GID['x'], GID['/']], default=GID['\\'])
    cover = masks()[ids].transpose(0, 2, 1, 3).reshape(ROWS_N * CELL_H, COLS_N * CELL_W)[:H, :W, None]
    ink = PALE + (HOT - PALE) * (heat ** 0.7)[..., None]
    # The hottest marks lift toward cream, so the ember has a bright heart.
    ink = ink + (CREAM - ink) * (np.clip((heat - 0.8) / 0.2, 0, 1) * 0.6)[..., None]
    colour = BGV + (ink - BGV) * (0.42 + 0.58 * heat)[..., None]
    colour = np.repeat(np.repeat(colour, CELL_H, 0), CELL_W, 1)[:H, :W]
    return colour * cover, cover


def with_marks(img, t, at, moments=4):
    """Lays the marks over a picture, averaged over the frame's own duration."""
    colour = np.zeros((H, W, 3), np.float32)
    cover = np.zeros((H, W, 1), np.float32)
    for j in range(moments):
        tj = t + ((j + 0.5) / moments - 0.5) / FPS
        c, a = layer(*field(tj, *at(tj)))
        colour += c
        cover += a
    out = np.asarray(img, np.float32) * (1 - cover / moments) + colour / moments
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def opening(t):
    """ASCII alone: a turning ember of marks that bursts into a ring and sweeps off the picture."""
    k = smooth((t - 0.8) / 0.7)
    return W / 2, H / 2, (24 + 5 * smooth(t / 0.8)) * UNIT, 1 - min(1.0, k * 2.2), (20 + 52 * k) * UNIT if k > 0 else None, 1 - 0.4 * k


def closing(t):
    k = smooth((t - 12.2) / 0.8)
    return W / 2, H / 2, UNIT, 0.0, (4 + 68 * k) * UNIT, 1 - 0.4 * k


def hole(radius):
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).ellipse((W / 2 - radius, H / 2 - radius, W / 2 + radius, H / 2 + radius), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(10))


def end_card(t):
    img = with_marks(Image.new('RGB', (W, H), BG), t, lambda tj: (W / 2, 300, 9 * UNIT, 1.0), moments=2)
    d = ImageDraw.Draw(img)
    d.text((W / 2, 590), 'model-picker', font=font(f'{SANS}/AnthropicSans-Romans-Variable-25x258.ttf', 132),
           fill=mix(BG, INK, smooth((t - 12.6) / 0.3)), anchor='mm')
    d.text((W / 2, 740), '/plugin install model-picker --marketplace nithinaru/model-picker', font=font(MONO, 30),
           fill=mix(BG, DIM, smooth((t - 12.9) / 0.3)), anchor='mm')
    return img


def frame(film, t):
    # The opening: ASCII alone, already burning, which bursts into a ring that uncovers the window.
    if t < 1.55:
        k = smooth((t - 0.8) / 0.7)
        img = Image.new('RGB', (W, H), BG)
        if k > 0:
            img = Image.composite(film.shot(t), img, hole((20 + 52 * k - 3) * UNIT))
        return with_marks(img, t, opening)
    img = film.shot(t)
    # The ending arrives the way the film began: a ring of ASCII sweeps out, and the card is inside it.
    if t >= 12.2:
        k = smooth((t - 12.2) / 0.8)
        if k >= 1:
            return end_card(t)
        img = with_marks(Image.composite(end_card(t), img, hole((4 + 68 * k - 3) * UNIT)), t, closing)
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


def build_audio(path, track):
    N = int((DUR + 0.5) * SR)
    buf = np.zeros(N)

    def add(t, sig, gain=1.0):
        i = int(t * SR)
        n = min(len(sig), N - i)
        if n > 0 and i >= 0:
            buf[i:i + n] += sig[:n] * gain

    def cr(t):
        return max(0.0, min(1.0, (t - (GRID_T0 - 1.5)) / (DROP - (GRID_T0 - 1.5)))) ** 1.6 if t < DROP else 1.0

    # What happens on screen.
    add(0.0, whoosh(0.8, up=True, gain=0.35))
    add(0.8, pop(0.6, 200))
    add(0.8, whoosh(0.85, up=False, gain=0.7))
    add(2.3, pop(0.5, 420))
    add(2.52, poof())
    add(3.2, whoosh(0.5, up=False, gain=0.3))
    add(3.6, pop(0.55, 380))
    for at in CLICKS:
        add(at, tick(), 1.3)
    add(4.55, whoosh(0.7, up=True, gain=0.6))
    last = ''
    for i, p in enumerate(track):
        if p['cell'] and p['cell'] != last:
            add(GRID_T0 + i / FPS, tick(), 0.8)
        last = p['cell'] or last
    add(12.2, pop(0.6, 200))
    add(12.2, whoosh(0.85, up=False, gain=0.7))

    # The music: pads under everything, a riser into the grid, drums from the grid, the drop on the fling.
    bar = 4 * BEAT
    chords = [(220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (130.8, 164.8, 196.0), (196.0, 246.9, 293.7)]
    t0 = GRID_T0 - 3 * bar
    for b in range(40):
        t = t0 + b * bar
        if t >= DUR - 1.0:
            break
        if t >= 0:
            add(t, chord(chords[b % 4], bar + 0.2), 0.45 + 0.55 * cr(t))
    add(GRID_T0 - 1.5, riser(DROP - GRID_T0 + 1.5))
    for j in range(200):
        t = GRID_T0 - 2 * BEAT + j * BEAT / 2
        if t >= DUR - 1.6:
            break
        add(t, hat(j), 0.4 + 0.6 * cr(t))
    notes = [55.0, 55.0, 65.41, 55.0, 43.65, 49.0, 41.2, 49.0]
    for k in range(100):
        t = GRID_T0 + k * BEAT
        if t >= DUR - 1.7:
            break
        add(t, kick(), 0.9 if t < DROP - 0.02 else 1.1)
        add(t, bass(notes[k % 8], BEAT * 0.45), 0.4 + 0.6 * cr(t))
    add(DROP, crash(), 0.6)

    # A breath of near silence before the drop, and the fade at the end.
    buf[int((DROP - 0.16) * SR):int(DROP * SR)] *= 0.12
    fade = np.ones(N)
    fi = int(13.6 * SR)
    fade[fi:] = np.linspace(1.0, 0.0, N - fi)
    buf = np.tanh(buf * fade * 1.1) * 0.85
    pcm = (buf[:int(DUR * SR)] * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.column_stack([pcm, pcm]).tobytes())


def main():
    film = Film()
    wav = os.path.join(TMP, 'launch.wav')
    build_audio(wav, film.track)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ff = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', wav,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT,
    ], stdin=subprocess.PIPE)
    for i in range(int(DUR * FPS)):
        ff.stdin.write(frame(film, i / FPS).tobytes())
    ff.stdin.close()
    ff.wait()
    print(OUT)


if __name__ == '__main__':
    main()
