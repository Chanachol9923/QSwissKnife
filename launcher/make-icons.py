"""Draw the QSwissKnife app icon and export every size the app and Windows need.

    python launcher/make-icons.py

Outputs: launcher/qswissknife.ico (16–256 px), public/icon-192.png, public/icon-512.png,
public/apple-touch-icon.png, public/favicon-32.png
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 4096  # draw big, downsample for smooth edges
K = S / 1024  # design units are 0..1024


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_tile():
    """Rounded square with a violet → cyan diagonal gradient."""
    c1, c2 = (124, 92, 255), (34, 211, 238)
    small = Image.new('RGB', (256, 256))
    px = small.load()
    for y in range(256):
        for x in range(256):
            px[x, y] = lerp(c1, c2, min(1, max(0, (x * 0.55 + y * 0.45) / 255)))
    grad = small.resize((S, S), Image.BICUBIC)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(230 * K), fill=255)
    tile = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)
    # soft top highlight
    hl = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hl).ellipse([-0.3 * S, -0.75 * S, 1.3 * S, 0.45 * S], fill=40)
    hl = hl.resize((256, 256), Image.BILINEAR).filter(ImageFilter.GaussianBlur(14)).resize((S, S), Image.BICUBIC)
    hl = Image.composite(hl, Image.new('L', (S, S), 0), mask)
    tile = Image.alpha_composite(tile, Image.merge('RGBA', (*[Image.new('L', (S, S), 255)] * 3, hl)))
    return tile


def rot(points, deg, cx=512, cy=512):
    a = math.radians(deg)
    out = []
    for x, y in points:
        dx, dy = x - cx, y - cy
        out.append(((cx + dx * math.cos(a) - dy * math.sin(a)) * K, (cy + dx * math.sin(a) + dy * math.cos(a)) * K))
    return out


def quad(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


# Knife laid out horizontally in design units, then rotated -40° so it points up-right.
ANGLE = -40
BLADE = [(420, 448), (790, 448), (880, 478)] + quad((880, 478), (720, 600), (420, 604))
SPINE = [(420, 448), (790, 448), (880, 478), (790, 470), (420, 470)]
BOLSTER = [(392, 436), (430, 436), (430, 616), (392, 616)]
HANDLE_BOX = (150, 462, 400, 590)


def knife_layer():
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # handle: draw upright then rotate the whole layer for a true rounded rect
    h = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(h)
    x0, y0, x1, y1 = (v * K for v in HANDLE_BOX)
    hd.rounded_rectangle([x0, y0, x1, y1], radius=int(58 * K), fill=(17, 20, 36, 255))
    for rx in (222, 322):
        r = 15 * K
        cx, cy = rx * K, 526 * K
        hd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(167, 148, 255, 255))
    layer = Image.alpha_composite(layer, h.rotate(-ANGLE, resample=Image.BICUBIC, center=(512 * K, 512 * K)))
    d = ImageDraw.Draw(layer)
    d.polygon(rot(BOLSTER, ANGLE), fill=(222, 228, 240, 255))
    d.polygon(rot(BLADE, ANGLE), fill=(255, 255, 255, 255))
    d.polygon(rot(SPINE, ANGLE), fill=(226, 232, 245, 255))
    return layer


def build():
    tile = gradient_tile()
    knife = knife_layer()
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow.putalpha(knife.getchannel('A').point(lambda a: int(a * 0.35)))
    shadow = shadow.transform((S, S), Image.AFFINE, (1, 0, -10 * K, 0, 1, -26 * K)).filter(ImageFilter.GaussianBlur(28 * K))
    # keep the shadow inside the tile
    shadow.putalpha(Image.composite(shadow.getchannel('A'), Image.new('L', (S, S), 0), tile.getchannel('A')))
    # shift the knife slightly so it sits optically centred
    knife = knife.transform((S, S), Image.AFFINE, (1, 0, 14 * K, 0, 1, -6 * K))
    return Image.alpha_composite(Image.alpha_composite(tile, shadow), knife)


def main():
    icon = build()
    big = icon.resize((1024, 1024), Image.LANCZOS)
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    big.resize((256, 256), Image.LANCZOS).save(ROOT / 'launcher' / 'qswissknife.ico', sizes=[(s, s) for s in sizes])
    for name, s in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
        big.resize((s, s), Image.LANCZOS).save(ROOT / 'public' / name, optimize=True)
    big.resize((256, 256), Image.LANCZOS).save(ROOT / 'launcher' / 'preview-256.png')
    print('icons written')


if __name__ == '__main__':
    main()
