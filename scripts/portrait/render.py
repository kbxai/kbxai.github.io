"""Step 3: turn the analysed face into a stylised ASCII *character*.

Inputs (scripts/portrait/out/): primary.npz (landmarks, person mask, alignment), structure.npz (mean
shape from all photos), median-face.png, primary-depth.npy, plus the primary photo itself (read only).

Character recipe:
  1. crop head + shoulders (4:5) around the primary face
  2. face tone = primary blended with the median face of ALL photos (cleaner skin, steadier lighting)
  3. bilateral smoothing + CLAHE + gamma, then posterise into flat cel-shading bands
  4. contour strokes from landmarks (70% primary, 30% mean shape of all photos): jaw, brows, eyes, irises, nose, lips
  5. XDoG lines for hair/beard texture + person-mask silhouette outline
  6. depth (Depth Anything V2) inside the mask
Outputs:
  public/portrait/maps.png   RGBA: R luminance, G edge (dir*64 + strength), B depth, A mask   (for the shader)
  src/data/portrait-ascii.txt   text portrait (terminal `whoami --face`)
  public/portrait/fallback.webp glowing raster of the text portrait (static fallback)
  scripts/portrait/out/contact-sheet.png  variants for review (gitignored)
"""
from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path

_m = types.ModuleType("matplotlib")
_m.pyplot = types.ModuleType("matplotlib.pyplot")
sys.modules.setdefault("matplotlib", _m)
sys.modules.setdefault("matplotlib.pyplot", _m.pyplot)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from mediapipe.python.solutions import face_mesh_connections as fmc  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "out"
ROOT = HERE.parent.parent
FONT = Path("G:/ml-tools/pylib/matplotlib/mpl-data/fonts/ttf/DejaVuSansMono-Bold.ttf")

FILL = " .,:;=+*#%@"      # must match src/three/portrait-shader.ts
EDGE = "-/|\\"            # horizontal, rising, vertical, falling
MAP_COLS_HI, MAP_COLS_LO = 120, 72  # shader textures: one texel per character cell
CELL_ASPECT = 1.6                   # character cell height / width in the shader grid
OUTER_LIP = {61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409}


def edges_of(conn) -> list[tuple[int, int]]:
    return [(a, b) for a, b in conn]


def crop_box(lm: np.ndarray, w: int, h: int) -> tuple[int, int, int, int]:
    xs, ys = lm[:, 0], lm[:, 1]
    cx = (xs.min() + xs.max()) / 2
    face_h = ys.max() - ys.min()
    top = ys.min() - face_h * 0.75          # room for the hair
    bottom = ys.max() + face_h * 0.85       # neck + shoulders
    ch = bottom - top
    cw = ch * 0.8
    x0 = int(round(cx - cw / 2))
    y0 = int(round(top))
    x0 = max(0, min(x0, w - int(cw)))
    y0 = max(0, y0)
    return x0, y0, int(cw), int(min(ch, h - y0))


def xdog(gray: np.ndarray, sigma=1.1, k=1.6, tau=0.98, eps=-0.004, phi=60.0) -> np.ndarray:
    g = gray.astype(np.float32) / 255.0
    g1 = cv2.GaussianBlur(g, (0, 0), sigma)
    g2 = cv2.GaussianBlur(g, (0, 0), sigma * k)
    d = g1 - tau * g2
    e = np.where(d >= eps, 1.0, 1.0 + np.tanh(phi * (d - eps)))
    return 1.0 - np.clip(e, 0, 1)  # 1 = line


def build(primary: Path) -> dict[str, np.ndarray]:
    img = cv2.imread(str(primary))
    h, w = img.shape[:2]
    P = np.load(OUT / "primary.npz")
    S = np.load(OUT / "structure.npz")
    lm, mask, M = P["landmarks"], P["mask"], P["M"]
    depth = np.load(OUT / "primary-depth.npy")
    median = cv2.imread(str(OUT / "median-face.png"), cv2.IMREAD_GRAYSCALE)

    # mean shape (aligned frame) -> primary frame, blended with the primary's own landmarks
    Minv = cv2.invertAffineTransform(M)
    mean_in_primary = cv2.transform(S["mean_shape"][None].astype(np.float32), Minv)[0]
    shape = 0.7 * lm + 0.3 * mean_in_primary

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    med_back = cv2.warpAffine(median, Minv, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    oval = np.zeros((h, w), np.uint8)
    hull = cv2.convexHull(lm.astype(np.int32))
    cv2.fillConvexPoly(oval, hull, 255)
    oval = cv2.GaussianBlur(oval.astype(np.float32) / 255, (0, 0), 9)
    med_match = cv2.normalize(med_back, None, float(gray[oval > 0.5].min()), float(gray[oval > 0.5].max()), cv2.NORM_MINMAX)
    tone = gray.astype(np.float32) * (1 - 0.45 * oval) + med_match.astype(np.float32) * (0.45 * oval)

    x0, y0, cw, ch = crop_box(lm, w, h)
    sl = (slice(y0, y0 + ch), slice(x0, x0 + cw))
    tone = tone[sl]
    m = cv2.GaussianBlur(mask[sl], (0, 0), 1.5)
    d = depth[sl]
    pts = shape - np.array([x0, y0], np.float32)

    t = cv2.bilateralFilter(np.clip(tone, 0, 255).astype(np.uint8), 9, 40, 7)
    t = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(6, 6)).apply(t)
    tf = (t.astype(np.float32) / 255.0) ** 0.85
    bands = 5
    poster = np.floor(tf * bands + 0.5) / bands
    lum = np.clip(0.55 * poster + 0.45 * tf, 0, 1) ** 1.55
    chin_y = pts[152][1]
    yy = np.arange(lum.shape[0], dtype=np.float32)[:, None]
    fade = np.clip(1.0 - (yy - chin_y) / (lum.shape[0] - chin_y + 1e-6), 0.25, 1.0)
    lum = lum * fade

    # contour strokes from landmarks
    strokes = np.zeros(t.shape, np.uint8)
    LIPS_OUTER = frozenset((a, b) for a, b in fmc.FACEMESH_LIPS if a in OUTER_LIP and b in OUTER_LIP)
    sets = [fmc.FACEMESH_FACE_OVAL, fmc.FACEMESH_LEFT_EYEBROW, fmc.FACEMESH_RIGHT_EYEBROW, fmc.FACEMESH_LEFT_EYE,
            fmc.FACEMESH_RIGHT_EYE, LIPS_OUTER, fmc.FACEMESH_LEFT_IRIS, fmc.FACEMESH_RIGHT_IRIS]
    thick = max(2, cw // 160)
    for s in sets:
        for a, b in edges_of(s):
            if s is fmc.FACEMESH_FACE_OVAL and min(pts[a][1], pts[b][1]) < pts[10][1] + (pts[152][1] - pts[10][1]) * 0.35:
                continue  # skip the forehead part of the oval (hairline is drawn by XDoG instead)
            cv2.line(strokes, tuple(np.round(pts[a]).astype(int)), tuple(np.round(pts[b]).astype(int)), 255, thick, cv2.LINE_AA)
    strokes = strokes.astype(np.float32) / 255 * 0.9

    lines = xdog(cv2.GaussianBlur(t, (0, 0), 0.8)) * (m > 0.5)
    lines = cv2.morphologyEx((lines > 0.5).astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(np.float32)
    sil = cv2.morphologyEx((m > 0.5).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(np.float32)
    edge = np.clip(np.maximum.reduce([strokes, lines * 0.85, sil]), 0, 1)

    # edge direction from the structure tensor of the edge map
    gx = cv2.Sobel(cv2.GaussianBlur(edge, (0, 0), 1.2), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(cv2.GaussianBlur(edge, (0, 0), 1.2), cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), 2)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), 2)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), 2)
    theta = 0.5 * np.arctan2(2 * jxy, jxx - jyy)          # gradient orientation
    line_angle = (theta + np.pi / 2) % np.pi              # line runs perpendicular to the gradient
    dir_idx = (np.floor((line_angle + np.pi / 8) / (np.pi / 4)) % 4).astype(np.uint8)  # 0 -,1 /,2 |,3 \ (image y down)
    dir_idx = np.choose(dir_idx, [0, 3, 2, 1]).astype(np.uint8)  # flip diagonals for y-down coordinates

    dm = d.copy()
    inside = m > 0.5
    if inside.any():
        lo, hi = np.percentile(dm[inside], [2, 98])
        dm = np.clip((dm - lo) / (hi - lo + 1e-6), 0, 1)
    dm = cv2.GaussianBlur(dm * m, (0, 0), 3)
    return {"lum": lum * m, "edge": edge, "dir": dir_idx, "depth": dm, "mask": m}


def to_ascii(maps: dict[str, np.ndarray], cols: int, fill=FILL, edge_thr=0.45, edges=True, aspect=0.5) -> list[str]:
    h, w = maps["mask"].shape
    cell_w = w / cols
    rows = int(round(h / (cell_w / aspect)))
    def cell(arr, interp=cv2.INTER_AREA):
        return cv2.resize(arr.astype(np.float32), (cols, rows), interpolation=interp)
    lum, edge, mask = cell(maps["lum"]), cell(maps["edge"]), cell(maps["mask"])
    dirs = cv2.resize(maps["dir"], (cols, rows), interpolation=cv2.INTER_NEAREST)
    out = []
    for y in range(rows):
        row = []
        for x in range(cols):
            if mask[y, x] < 0.35:
                row.append(" ")
            elif edges and edge[y, x] > edge_thr:
                row.append(EDGE[dirs[y, x]])
            else:
                i = int(np.clip(lum[y, x], 0, 0.999) * len(fill))
                row.append(fill[i])
        out.append("".join(row).rstrip())
    while out and not out[-1].strip():
        out.pop()
    return out


def render_text(lines: list[str], size=13, glow=True, cell_aspect: float | None = None, edge_color=(255, 180, 84), fill_color=(124, 255, 138), bg=(11, 15, 12, 0)) -> Image.Image:
    font = ImageFont.truetype(str(FONT), size)
    cw = font.getbbox("M")[2]
    lh = int(round(cw * cell_aspect)) if cell_aspect else int(size * 1.08)
    W, H = cw * max(len(l) for l in lines) + 16, lh * len(lines) + 16
    img = Image.new("RGBA", (W, H), bg)
    dr = ImageDraw.Draw(img)
    for y, line in enumerate(lines):
        for x, ch in enumerate(line):
            if ch == " ":
                continue
            if ch in EDGE:
                col, a = edge_color, 255
            else:
                k = FILL.index(ch) / (len(FILL) - 1) if ch in FILL else 0.6
                col, a = fill_color, int(255 * (0.35 + 0.65 * k))
            dr.text((8 + x * cw, 8 + y * lh), ch, font=font, fill=col + (a,))
    if glow:
        halo = img.filter(ImageFilter.GaussianBlur(3))
        img = Image.alpha_composite(halo, img)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--primary", required=True)
    ap.add_argument("--cols", type=int, default=96)
    args = ap.parse_args()
    maps = build(Path(args.primary))

    # contact sheet of variants
    variants = [
        ("A classic 80", dict(cols=80)),
        ("B classic 110", dict(cols=110)),
        ("C classic 140", dict(cols=140)),
        ("D no-edge 110", dict(cols=110, edges=False)),
        ("E 120 thr.35", dict(cols=120, edge_thr=0.35)),
        ("F 120 thr.55", dict(cols=120, edge_thr=0.55)),
    ]
    tiles = []
    for name, kw in variants:
        im = render_text(to_ascii(maps, **kw), size=9 if kw["cols"] > 100 else 11)
        im = im.resize((440, int(440 * im.height / im.width)))
        tile = Image.new("RGB", (440, im.height + 26), (11, 15, 12))
        tile.paste(im, (0, 26), im)
        ImageDraw.Draw(tile).text((8, 6), name, fill=(200, 200, 200), font=ImageFont.truetype(str(FONT), 14))
        tiles.append(tile)
    th = max(t.height for t in tiles)
    sheet = Image.new("RGB", (440 * 3, th * 2), (0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 3) * 440, (i // 3) * th))
    sheet.save(OUT / "contact-sheet.png")

    # debug maps
    for k in ("lum", "edge", "depth", "mask"):
        cv2.imwrite(str(OUT / f"map-{k}.png"), (np.clip(maps[k], 0, 1) * 255).astype(np.uint8))

    # shader textures: ONE TEXEL PER CHARACTER CELL (same aggregation as to_ascii), so the live render
    # matches the text portrait exactly. Cells are 1:1.6 (w:h) like the shader's grid.
    (ROOT / "public" / "portrait").mkdir(parents=True, exist_ok=True)
    meta = {}
    for name, cols in (("maps", MAP_COLS_HI), ("maps-lo", MAP_COLS_LO)):
        h, w = maps["mask"].shape
        rows = int(round(h / (w / cols * CELL_ASPECT)))
        rs = lambda a: cv2.resize(a.astype(np.float32), (cols, rows), interpolation=cv2.INTER_AREA)
        edge_s = np.clip(rs(maps["edge"]), 0, 1)
        dirs = cv2.resize(maps["dir"], (cols, rows), interpolation=cv2.INTER_NEAREST).astype(np.float32)
        g = np.where(edge_s > 0.05, dirs * 64 + np.round(edge_s * 63), 0)
        rgba = np.dstack([rs(maps["lum"]) * 255, g, rs(maps["depth"]) * 255, rs(maps["mask"]) * 255])
        Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(ROOT / "public" / "portrait" / f"{name}.png", optimize=True)
        meta[name] = {"cols": cols, "rows": rows}
    (ROOT / "src" / "data" / "portrait-meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="\n")
    rgba = np.zeros((meta["maps"]["rows"], meta["maps"]["cols"], 4))

    lines = to_ascii(maps, cols=args.cols, edge_thr=0.35)
    (ROOT / "src" / "data" / "portrait-ascii.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    fb = render_text(to_ascii(maps, cols=120, edge_thr=0.35, aspect=1 / CELL_ASPECT), size=10, cell_aspect=CELL_ASPECT)
    fb.save(ROOT / "public" / "portrait" / "fallback.webp", "WEBP", quality=62, method=6)
    print("maps", rgba.shape, "ascii", len(lines), "rows x", args.cols, "cols; fallback", fb.size)


if __name__ == "__main__":
    main()
