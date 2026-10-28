#!/usr/bin/env python3
"""Build install icons and iOS launch images from assets/app-mark.png.

Requires Pillow. Run from any directory with: python3 frontend/scripts/gen-install-assets.py
The transparent source mark is composited onto the default palette's background. Generated
PNGs are committed so ordinary frontend builds do not require Python or Pillow.
"""
import json
from pathlib import Path
from PIL import Image

FRONT = Path(__file__).resolve().parent.parent
PUBLIC = FRONT / 'public'
SOURCE = FRONT / 'assets' / 'app-mark.png'

# Portrait CSS dimensions and device pixel ratios used by index.html.
SCREENS = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3), (375, 812, 3), (414, 896, 2), (414, 896, 3),
    (390, 844, 3), (428, 926, 3), (393, 852, 3), (430, 932, 3), (402, 874, 3), (440, 956, 3),
]


def background():
    data = json.loads((FRONT / 'src' / 'theme' / 'palettes.json').read_text())
    return next(p['tokens']['bg0'] for p in data['palettes'] if p['name'] == data['default'])


def load_mark():
    mark = Image.open(SOURCE).convert('RGBA')
    alpha = mark.getchannel('A')
    # Ignore near-transparent export speckles when measuring the visible mark.
    box = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
    if not box or alpha.getextrema()[0] != 0:
        raise ValueError('app-mark.png must contain a visible mark on a transparent background')
    return mark.crop(box)


def render(mark, bg, width, height, max_width, max_height, center_y):
    scale = min(max_width / mark.width, max_height / mark.height)
    resized = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.Resampling.LANCZOS)
    result = Image.new('RGB', (width, height), bg)
    result.paste(resized, ((width - resized.width) // 2, round(center_y - resized.height / 2)), resized)
    return result


def main():
    mark, bg = load_mark(), background()
    for size in (180, 192, 512):
        # A 66% x 34% box fits entirely within the maskable icon's 40%-radius safe circle.
        icon = render(mark, bg, size, size, size * .66, size * .34, size / 2)
        path = PUBLIC / f'icon-{size}.png'
        icon.save(path, optimize=True)
        print('wrote', path.relative_to(PUBLIC))
    (PUBLIC / 'splash').mkdir(exist_ok=True)
    for w, h, ratio in SCREENS:
        width, height = w * ratio, h * ratio
        splash = render(mark, bg, width, height, width * .34, height * .2, height * .46)
        path = PUBLIC / 'splash' / f'splash-{width}x{height}.png'
        splash.save(path, optimize=True)
        print('wrote', path.relative_to(PUBLIC))


if __name__ == '__main__':
    main()
