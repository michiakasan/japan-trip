"""Draws the app icons (the red 旅 stamp) into public/icons/.

Run it with:  python3 scripts/make-icons.py
Needs the Pillow library and a Japanese font (Noto Serif CJK is used if installed).
You only need to run this again if you want to change the icon.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

VERMILION = (179, 54, 31)   # --accent in light mode
PAPER = (247, 243, 234)     # --bg in light mode
FONT = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"  # index 0 = Japanese


def draw(size: int, glyph_scale: float, rounded: bool) -> Image.Image:
    """A vermilion square with 旅 in washi-paper colour.
    glyph_scale: how big the character is compared to the icon.
    rounded: small rounded corners (Android "maskable" icons must be full squares)."""
    big = size * 4  # draw 4x larger, then shrink: smoother edges
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(big * 0.18) if rounded else 0
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=VERMILION)
    font = ImageFont.truetype(FONT, int(big * glyph_scale), index=0)
    # Centre the character using its real drawn size
    box = d.textbbox((0, 0), "旅", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((big - w) / 2 - box[0], (big - h) / 2 - box[1]), "旅", font=font, fill=PAPER)
    return img.resize((size, size), Image.LANCZOS)


# Normal icons (with rounded corners) for browsers and the install prompt
draw(192, 0.62, True).save(OUT / "icon-192.png")
draw(512, 0.62, True).save(OUT / "icon-512.png")
# "Maskable": Android cuts its own shape (circle, squircle…), so fill the square and keep
# the character inside the middle 80% safe zone.
draw(512, 0.48, False).save(OUT / "icon-maskable-512.png")
# iPhone home screen icon: iOS rounds the corners itself and doesn't like transparency
draw(180, 0.6, False).convert("RGB").save(OUT / "apple-touch-icon.png")
# Small icon for the browser tab
draw(64, 0.7, True).save(OUT / "favicon-64.png")
print("Icons written to", OUT)
