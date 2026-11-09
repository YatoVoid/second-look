import sys
from pathlib import Path
from PIL import Image

PALETTE = {
    '.': (0x16, 0x23, 0x8f, 255),
    'B': (0x0d, 0x16, 0x63, 255),
    'Y': (0xf4, 0xd6, 0x5a, 255),
    'P': (0xff, 0xff, 0xff, 255),
    'K': (0x00, 0x00, 0x00, 255),
    'C': (0x5c, 0xc3, 0xcc, 255),
}

GRID = """
BBBBBBBBBBBBBBBB
B..............B
B..PYYYYYYYYY..B
B..PYYYYYYYYYK.B
B..PYYYYYYY....B
B..PYYYYYYY....B
B..PYYYYYYYYY..B
B..PYYYYYYYYYK.B
B..PKKKKKKKKKK.B
B..PK..........B
B..PK..........B
B..PK..........B
B..PK..........B
B.CCCCC........B
B..KKKKK.......B
BBBBBBBBBBBBBBBB
""".strip().splitlines()

assert len(GRID) == 16 and all(len(r) == 16 for r in GRID), 'grid must be 16x16'


def render(scale):
    img = Image.new('RGBA', (16, 16))
    for y, row in enumerate(GRID):
        for x, ch in enumerate(row):
            img.putpixel((x, y), PALETTE[ch])
    return img.resize((16 * scale, 16 * scale), Image.NEAREST)


def svg():
    rects = []
    for y, row in enumerate(GRID):
        x = 0
        while x < 16:
            ch = row[x]
            run = 1
            while x + run < 16 and row[x + run] == ch:
                run += 1
            r, g, b, _ = PALETTE[ch]
            rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
            x += run
    body = '\n  '.join(rects)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="128" height="128" '
        f'shape-rendering="crispEdges">\n  {body}\n</svg>\n'
    )


out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    render(size // 16).save(out / f'icon-{size}.png')
(out / 'icon.svg').write_text(svg())
print('wrote', sorted(p.name for p in out.iterdir()))
