"""Builds every icon and the social share image from the logo.   python scripts/make_assets.py

Reads:   web/public/logo.png  and  brand/regis-wordmark.png   (made by scripts/make_logo.py)
Writes:  web/public/  logo-512/192/128.png, favicon-16/32.png, favicon.ico, apple-touch-icon.png, og.png

Needs: pip install pillow fonttools   (and `npm install` once in web/, for the Instrument Serif font)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "web" / "public"
OLIVE, CREAM, RUST = (80, 81, 50), (228, 216, 192), (168, 95, 50)

logo = Image.open(PUB / "logo.png").convert("RGBA")
word = Image.open(ROOT / "brand" / "regis-wordmark.png").convert("RGBA")


def sized(px: int) -> Image.Image:
    return logo.resize((px, px), Image.LANCZOS)


for px in (512, 192, 128):
    sized(px).save(PUB / f"logo-{px}.png", optimize=True)
sized(32).save(PUB / "favicon-32.png", optimize=True)
sized(16).save(PUB / "favicon-16.png", optimize=True)
sized(48).save(PUB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

# Apple touch icons must be opaque, so the round badge sits on an olive square.
apple = Image.new("RGB", (180, 180), OLIVE)
apple.paste(sized(150), (15, 15), sized(150))
apple.save(PUB / "apple-touch-icon.png", optimize=True)


def font(style: str, size: int) -> ImageFont.FreeTypeFont:
    """Instrument Serif ships as woff in the npm package. Convert once so Pillow can read it."""
    try:
        from fontTools.ttLib import TTFont
        src = ROOT / "web" / "node_modules" / "@fontsource" / "instrument-serif" / "files" / f"instrument-serif-latin-{style}.woff"
        out = ROOT / "scripts" / f".{style}.ttf"
        if not out.exists():
            f = TTFont(str(src))
            f.flavor = None
            f.save(str(out))
        return ImageFont.truetype(str(out), size)
    except Exception:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", int(size * 0.8))


# Social share card, 1200 x 630: the badge, the wordmark, the tagline, and the ruler from the artwork.
W, H = 1200, 630
card = Image.new("RGB", (W, H), OLIVE)
d = ImageDraw.Draw(card)
badge = sized(400)
card.paste(badge, (100, 95), badge)
w = 520
wm = word.resize((w, round(word.height * w / word.width)), Image.LANCZOS)
card.paste(wm, (610, 215), wm)
d.text((612, 345), "Time, by appointment.", font=font("400-italic", 56), fill=CREAM)
d.rectangle([0, 560, W, 561], fill=RUST)
for i in range(0, W + 1, 40):
    big = i == W // 2
    d.line([(i, 580), (i, 604 if big else 592)], fill=CREAM, width=3 if big else 2)
card.save(PUB / "og.png", optimize=True)
print("assets written to", PUB)
