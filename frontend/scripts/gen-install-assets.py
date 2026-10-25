#!/usr/bin/env python3
"""Install assets in the default palette's colours.

Recolours public/icon-180.png and public/icon-512.png from the upstream lime-on-graphite
originals, and writes the iOS launch images in public/splash/. Reads the colours from
src/theme/palettes.json (the default palette's bg0 and accent). The icons are flat two-colour
art with blended edge pixels, so each pixel is re-mixed between the new background and the
new accent at the same ratio it had between the old ones.

Needs Pillow (pip install pillow). Not part of the build; re-run by hand when the default
palette's background or accent changes:  python3 scripts/gen-install-assets.py
The recolouring needs the original lime icons. After the first run public/ holds the
recoloured ones, so pass --from <dir> with the upstream icon-180.png and icon-512.png
(for example from `git show 5dd3da32:frontend/public/icon-512.png`). The script stops if
the source icons don't contain the original lime.
"""
import json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.dirname(HERE)
PUBLIC = os.path.join(FRONT, 'public')
OLD_BG, OLD_ACC = (12, 14, 18), (163, 230, 53)

# iOS launch images: CSS width x height at a device pixel ratio, portrait (the manifest
# locks portrait). One per iPhone screen size in use; an unmatched size falls back to
# the manifest background colour, as before.
SCREENS = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3), (375, 812, 3), (414, 896, 2), (414, 896, 3),
    (390, 844, 3), (428, 926, 3), (393, 852, 3), (430, 932, 3), (402, 874, 3), (440, 956, 3),
]

def hexrgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def palette():
    data = json.load(open(os.path.join(FRONT, 'src', 'theme', 'palettes.json')))
    p = next(p for p in data['palettes'] if p['name'] == data['default'])
    return hexrgb(p['tokens']['bg0']), hexrgb(p['tokens']['accent'])

def recolour(img, bg, acc):
    img = img.convert('RGB')
    d = [b - a for a, b in zip(OLD_BG, OLD_ACC)]
    n = sum(x * x for x in d)
    def px(c):
        t = sum((c[i] - OLD_BG[i]) * d[i] for i in range(3)) / n
        t = min(1.0, max(0.0, t))
        return tuple(round(bg[i] + (acc[i] - bg[i]) * t) for i in range(3))
    cache = {}
    out = Image.new('RGB', img.size)
    out.putdata([cache.setdefault(c, px(c)) for c in (img.get_flattened_data() if hasattr(img, 'get_flattened_data') else img.getdata())])
    return out

def splash(icon512, bg, w, h):
    img = Image.new('RGB', (w, h), bg)
    # the mark alone (no icon tile), 34% of the screen width, slightly above centre
    diff = Image.eval(icon512.convert('L'), lambda v: 255 if v > 30 else 0)
    box = diff.getbbox()
    mark = icon512.crop(box)
    mw = round(w * 0.34); mh = round(mark.height * mw / mark.width)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    img.paste(mark, ((w - mw) // 2, round(h * 0.46) - mh // 2))
    return img

def main():
    src = PUBLIC
    if '--from' in sys.argv: src = sys.argv[sys.argv.index('--from') + 1]
    bg, acc = palette()
    icons = {}
    for name in ('icon-180.png', 'icon-512.png'):
        im = Image.open(os.path.join(src, name)).convert('RGB')
        colours = {c for _, c in im.getcolors(1 << 20)}
        if OLD_ACC not in colours:
            sys.exit(f'{name}: no original accent {OLD_ACC}; pass --from <dir with the upstream icons>')
        icons[name] = recolour(im, bg, acc)
        icons[name].save(os.path.join(PUBLIC, name), optimize=True)
        print('wrote', name)
    os.makedirs(os.path.join(PUBLIC, 'splash'), exist_ok=True)
    links = []
    for w, h, r in SCREENS:
        pw, ph = w * r, h * r
        f = f'splash-{pw}x{ph}.png'
        splash(icons['icon-512.png'], bg, pw, ph).quantize(64).save(os.path.join(PUBLIC, 'splash', f), optimize=True)
        links.append(f'<link rel="apple-touch-startup-image" href="splash/{f}" media="(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: portrait)">')
        print('wrote splash/' + f)
    print('\n'.join(links))

if __name__ == '__main__':
    main()
