"""
Generates the app icon.

    python scripts/icon.py

Writes build/icon.png (1024) for electron-builder, build/icon.ico for Windows,
and resources/icon.png + resources/splash.png for @capacitor/assets.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 1024

BG_TOP = (28, 34, 48)
BG_BOTTOM = (14, 16, 21)
ACCENT = (124, 156, 255)
FG = (231, 236, 245)

FONTS = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]


def font(px):
    for path in FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    return ImageFont.load_default()


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def base():
    """Dark rounded tile with a soft vertical gradient."""
    img = Image.new("RGB", (SIZE, SIZE), BG_BOTTOM)
    px = img.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        px_row = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(SIZE):
            px[x, y] = px_row
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded_mask(SIZE, int(SIZE * 0.22)))
    return out


def draw_icon():
    img = base()
    d = ImageDraw.Draw(img)

    # "147" with the 4 in the accent colour, matching the in-app wordmark.
    f = font(int(SIZE * 0.42))
    parts = ["1", "4", "7"]
    colours = [FG, ACCENT, FG]
    widths = [d.textlength(p, font=f) for p in parts]
    total = sum(widths)
    x = (SIZE - total) / 2
    box = d.textbbox((0, 0), "147", font=f)
    y = (SIZE - (box[3] - box[1])) / 2 - box[1] - SIZE * 0.04

    for part, colour, w in zip(parts, colours, widths):
        d.text((x, y), part, font=f, fill=colour)
        x += w

    # Three dots underneath: the ladder, one filled per step.
    r = int(SIZE * 0.028)
    gap = int(SIZE * 0.11)
    cy = int(SIZE * 0.76)
    cx = SIZE // 2 - gap
    for i in range(3):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT if i == 0 else (58, 76, 128))
        cx += gap

    return img


def main():
    icon = draw_icon()

    build = os.path.join(ROOT, "build")
    res = os.path.join(ROOT, "resources")
    os.makedirs(build, exist_ok=True)
    os.makedirs(res, exist_ok=True)

    icon.save(os.path.join(build, "icon.png"))
    icon.save(
        os.path.join(build, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # Capacitor wants a square icon plus a splash it can letterbox.
    icon.save(os.path.join(res, "icon.png"))

    splash = Image.new("RGB", (2732, 2732), BG_BOTTOM)
    art = icon.resize((820, 820), Image.LANCZOS)
    splash.paste(art, ((2732 - 820) // 2, (2732 - 820) // 2), art)
    splash.save(os.path.join(res, "splash.png"))

    print("wrote build/icon.png, build/icon.ico, resources/icon.png, resources/splash.png")


if __name__ == "__main__":
    main()
