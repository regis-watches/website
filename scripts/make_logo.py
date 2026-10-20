"""Cuts the site logo out of the brand artwork.   python scripts/make_logo.py

Input:   brand/regis-logo-original.png   (the full Regis artwork: compass dial, REGIS wordmark, ruler)
Output:  web/public/logo.png             (the compass dial as a round badge, transparent corners)
         brand/regis-wordmark.png        (the REGIS lettering, cream on transparent)

The artwork has a grainy olive background. The cream strokes and the rust needle are keyed out of it and
re-drawn on flat olive, so the badge stays clean at every size. Run  python scripts/make_assets.py  afterwards
to rebuild the favicons, app icon and social share image.
Needs: pip install pillow numpy
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "regis-logo-original.png"
OLIVE = (80, 81, 50)
CREAM = (228, 216, 192)
RUST = (168, 95, 50)

art = Image.open(SRC).convert("RGB")
a = np.asarray(art).astype(float)


def layers(px: np.ndarray):
    """Returns (cream alpha, rust alpha) for an RGB block of the artwork.

    Cream strokes and lettering are high in blue; the olive background and the rust needle are both low in blue.
    The needle is told from the background by how far red sits above blue.
    """
    r, b = px[..., 0], px[..., 2]
    rust = np.clip((r - b - 40) / (118 - 40), 0, 1)
    cream = np.clip((b - 52) / (195 - 52), 0, 1) * (1 - rust)
    return cream, rust


def compose(px: np.ndarray) -> Image.Image:
    cream, rust = layers(px)
    out = np.zeros(px.shape, dtype=float) + np.array(OLIVE, dtype=float)
    out = out * (1 - cream[..., None]) + np.array(CREAM, dtype=float) * cream[..., None]
    out = out * (1 - rust[..., None]) + np.array(RUST, dtype=float) * rust[..., None]
    return Image.fromarray(out.round().astype("uint8"), "RGB")


# 1. the dial, as a round badge. Centre and radius were measured from the artwork.
CX, CY, R = 479.5, 454.0, 262
box = (round(CX - R), round(CY - R), round(CX + R), round(CY + R))
badge = compose(a[box[1]:box[3], box[0]:box[2]])
size = badge.size[0]
SS = 4                                                                     # supersample the circle edge
mask = Image.new("L", (size * SS, size * SS), 0)
ImageDraw.Draw(mask).ellipse((0, 0, size * SS - 1, size * SS - 1), fill=255)
mask = mask.resize((size, size), Image.LANCZOS)
badge = badge.convert("RGBA")
badge.putalpha(mask)
badge.resize((512, 512), Image.LANCZOS).save(ROOT / "web" / "public" / "logo.png", optimize=True)

# 2. the wordmark, as cream lettering on a transparent background
x0, y0, x1, y1 = 185, 748, 785, 860
cream, _ = layers(a[y0:y1, x0:x1])
word = Image.new("RGBA", (x1 - x0, y1 - y0), CREAM + (0,))
word.putalpha(Image.fromarray((cream * 255).round().astype("uint8"), "L"))
word = word.crop(word.getbbox())
word.save(ROOT / "brand" / "regis-wordmark.png", optimize=True)
print("wrote web/public/logo.png and brand/regis-wordmark.png")
