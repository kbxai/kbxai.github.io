"""Shape-matched ASCII portrait (offline prototype + data for the site).

Brightness-ramp ASCII is blurry because it treats every character as a grey pixel. This picks each cell's
character by *shape*: six sampling circles per cell describe where the light is inside the cell, every printable
character of JetBrains Mono 700 gets the same 6-D description of where its ink is, and the closest one wins
(technique after Alex Harri, "ASCII rendering", alexharri.com/blog/ascii-rendering; own implementation).
Contrast is sharpened per cell (global) and against light just outside the cell (directional), so edges such as
the profile line, the eye and the hairline land on characters that follow them.

Source prep (the photo is retouched first, gently, without changing any feature):
  - cut-out and colour grade from photo_cutout.py
  - under-eye shadows lifted towards the cheek below them (landmark polygons, feathered)
  - skin smoothed with an edge-preserving filter; no CLAHE (it made the shadows harsh)
  - a soft fall-off around the head, so shoulders and the T-shirt fade out with no edge anywhere

Run: PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/shape_ascii.py --src ../photo-profile.png --cols 110
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from photo_cutout import grade, mask_of  # noqa: E402

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
OUT = HERE / "out" / "shape"
FONT = ROOT / "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff"
ASPECT = 1.6
NL = chr(10)
GAMMA, CURVE = 1.15, 0.45
CHARS = "".join(chr(c) for c in range(32, 127))
# six internal circles (x, y in cell units): left column lowered, right column raised (staggered)
INNER = [(0.28, 0.20), (0.72, 0.14), (0.28, 0.52), (0.72, 0.46), (0.28, 0.84), (0.72, 0.78)]
# ten external circles just outside the cell, and which internal circle each one can darken
OUTER = [(0.28, -0.12), (0.72, -0.16), (-0.18, 0.20), (1.18, 0.14), (-0.18, 0.52), (1.18, 0.46),
         (-0.18, 0.84), (1.18, 0.78), (0.28, 1.12), (0.72, 1.08)]
AFFECT = [[0, 1, 2], [0, 1, 3], [2, 4], [3, 5], [6, 8, 9], [7, 8, 9]]
RADIUS = 0.27  # in cell widths


def glyph_vectors(cw=48) -> np.ndarray:
    ch = int(round(cw * ASPECT))
    font = ImageFont.truetype(str(FONT), int(round(cw / 0.6)))
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float32)
    disks = [((xx - x * cw) ** 2 + (yy - y * ch) ** 2) <= (RADIUS * cw) ** 2 for x, y in INNER]
    vec = []
    for c in CHARS:
        im = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(im).text((cw / 2, ch * 0.54), c, font=font, fill=255, anchor="mm")
        a = np.asarray(im, np.float32) / 255
        vec.append([a[d].mean() for d in disks])
    v = np.array(vec, np.float32)
    return v / np.maximum(v.max(0, keepdims=True), 1e-6)


def sample(L: np.ndarray, cols: int, rows: int, pts) -> np.ndarray:
    """Mean lightness inside each circle of every cell: a disk blur, then one read per circle centre."""
    H, W = L.shape
    cw, ch = W / cols, H / rows
    r = RADIUS * cw
    k = int(np.ceil(r)) * 2 + 1
    yy, xx = np.mgrid[0:k, 0:k] - k // 2
    disk = ((xx ** 2 + yy ** 2) <= r * r).astype(np.float32)
    blur = cv2.filter2D(L, -1, disk / disk.sum(), borderType=cv2.BORDER_CONSTANT)
    cy, cx = np.mgrid[0:rows, 0:cols].astype(np.float32)
    out = []
    for x, y in pts:
        px = np.clip(((cx + x) * cw).round().astype(int), 0, W - 1)
        py = np.clip(((cy + y) * ch).round().astype(int), 0, H - 1)
        inside = ((cx + x) * cw >= 0) & ((cx + x) * cw < W) & ((cy + y) * ch >= 0) & ((cy + y) * ch < H)
        out.append(np.where(inside, blur[py, px], 0))
    return np.stack(out, -1)


def enhance(v: np.ndarray, ext: np.ndarray, g_exp=1.8, d_exp=2.6) -> np.ndarray:
    m = v.max(-1, keepdims=True) + 1e-6
    v = (v / m) ** g_exp * m
    out = v.copy()
    for i, aff in enumerate(AFFECT):
        mi = np.maximum(v[..., i], ext[..., aff].max(-1)) + 1e-6
        out[..., i] = (v[..., i] / mi) ** d_exp * mi
    return out


def prepare(src: Path) -> tuple[np.ndarray, dict]:
    """Retouched lightness map of the person on black, plus landmarks, at work resolution."""
    import mediapipe as mp
    bgr0 = cv2.cvtColor(np.asarray(Image.open(src).convert("RGB")), cv2.COLOR_RGB2BGR)
    a0 = mask_of(bgr0)
    col = grade(bgr0, a0)
    h0, w0 = a0.shape
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True) as fm:
        res = fm.process(cv2.cvtColor(bgr0, cv2.COLOR_BGR2RGB))
    lm = np.array([(p.x * w0, p.y * h0) for p in res.multi_face_landmarks[0].landmark], np.float32)

    # lightness (perceptual), skin smoothed with an edge-preserving filter (features stay sharp)
    lab = cv2.cvtColor(np.clip(col, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB)
    L = lab[..., 0].astype(np.float32) / 255
    Ls = cv2.bilateralFilter(L, 0, 0.06, 5)
    Ls = cv2.bilateralFilter(Ls, 0, 0.05, 3)
    face_h = float(lm[152, 1] - lm[10, 1])

    # under-eye shadows: lift towards the cheek just below them, inside a feathered landmark polygon
    under = np.zeros((h0, w0), np.float32)
    for lid in ([33, 7, 163, 144, 145, 153, 154, 155, 133], [362, 382, 381, 380, 374, 373, 390, 249, 263]):
        p = lm[lid]
        poly = np.vstack([p, (p + [0, face_h * 0.13])[::-1]])
        cv2.fillPoly(under, [np.round(poly).astype(np.int32)], 1.0)
    under = cv2.GaussianBlur(under, (0, 0), face_h * 0.03)
    below = np.roll(cv2.GaussianBlur(Ls, (0, 0), face_h * 0.03), -int(face_h * 0.12), axis=0)
    Ls = Ls * (1 - under) + np.maximum(Ls, below * 0.97) * under

    # features crisp: local sharpening inside the face, and the eye, lash line, brow and mouth line taken
    # a little darker along his own landmarks, so the characters that land on them follow their shape
    face = np.zeros((h0, w0), np.uint8)
    oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
            176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
    cv2.fillPoly(face, [np.round(cv2.convexHull(lm[oval])).astype(np.int32)], 1)
    facef = cv2.GaussianBlur(face.astype(np.float32), (0, 0), face_h * 0.04)
    sharp = Ls + 0.9 * (Ls - cv2.GaussianBlur(Ls, (0, 0), face_h * 0.012))
    Ls = Ls * (1 - facef) + np.clip(sharp, 0, 1) * facef
    ink = np.zeros((h0, w0), np.float32)
    lw = max(1, int(round(face_h * 0.012)))
    for idx, th in (([33, 246, 161, 160, 159, 158, 157, 173, 133], 1.3), ([263, 466, 388, 387, 386, 385, 384, 398, 362], 1.3),
                    ([70, 63, 105, 66, 107], 2.2), ([300, 293, 334, 296, 336], 2.2),
                    ([78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308], 1.0)):
        cv2.polylines(ink, [np.round(lm[idx] * 4).astype(np.int32)], False, 1.0, int(lw * th), cv2.LINE_AA, shift=2)
    for iris in (468, 473):
        r = float(np.linalg.norm(lm[iris + 1] - lm[iris])) * 0.85
        cv2.circle(ink, (int(lm[iris, 0]), int(lm[iris, 1])), max(1, int(r)), 1.0, -1, cv2.LINE_AA)
    ink = cv2.GaussianBlur(ink, (0, 0), lw * 0.6)
    Ls = Ls * (1 - 0.55 * np.clip(ink, 0, 1))

    # tone: keep the light falling across the face (no clipping), skin in the upper-middle of the range,
    # dark hair lifted into a textured mid-dark band so the silhouette and the hair flow both read
    person = a0
    sk = Ls[(person > 0.9)]
    lo, hi = np.percentile(sk, 2), np.percentile(sk, 99.8)
    t = np.clip((Ls - lo * 0.5) / (hi - lo * 0.5), 0, 1)
    t = t ** GAMMA
    t = t * t * (3 - 2 * t) * CURVE + t * (1 - CURVE)   # S-curve: the shadow side of the face keeps its form
    detail = cv2.GaussianBlur(Ls, (0, 0), 1.2) - cv2.GaussianBlur(Ls, (0, 0), 7)
    hw = cv2.GaussianBlur(((t < 0.3) & (person > 0.5)).astype(np.float32), (0, 0), 3)
    hair_t = np.clip(0.2 + t * 0.7 + detail * 5.0, 0.08, 0.5)
    t = t * (1 - hw) + hair_t * hw
    # soft fall-off around the head: the body fades out long before any crop edge
    cx, cy = float(lm[:, 0].mean()), float(lm[:, 1].mean())
    yy, xx = np.mgrid[0:h0, 0:w0].astype(np.float32)
    dy = np.where(yy > cy, (yy - cy) / (face_h * 1.0), (cy - yy) / (face_h * 2.2))
    d = np.hypot((xx - cx) / (face_h * 1.35), dy)
    fall = np.clip((1.2 - d) / 0.5, 0, 1) ** 1.6
    t = t * person * fall
    t = np.where(t < 0.07, 0, t)            # no faint residue: below this a cell is simply empty
    return t, dict(lm=lm, face_h=face_h, cx=cx, cy=cy)


def crop_box(t: np.ndarray, info: dict, aspect_box=0.92):
    """Crop with empty margin on every side (nothing touches the edge), room in front of the face (he looks left)."""
    ys, xs = np.nonzero(t > 0.02)
    fh = info["face_h"]
    x0, x1 = xs.min() - fh * 0.22, xs.max() + fh * 0.08
    y0, y1 = ys.min() - fh * 0.10, ys.max() + fh * 0.04
    w, h = x1 - x0, y1 - y0
    if w / h < aspect_box:   # widen to the box aspect, keeping the face's lead room on the left
        x1 = x0 + h * aspect_box
    return int(x0), int(y0), int(x1), int(y1)


def apply_box(arr: np.ndarray, box) -> np.ndarray:
    x0, y0, x1, y1 = box
    H, W = arr.shape[:2]
    pad = int(max(0, -x0, -y0, x1 - W, y1 - H)) + 2
    ap = cv2.copyMakeBorder(arr, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    return ap[y0 + pad:y1 + pad, x0 + pad:x1 + pad]


def normals(shape) -> tuple[np.ndarray, np.ndarray]:
    """Surface normals from the Depth Anything map of the same photo (scripts/portrait/out/photo/depth.npy)."""
    d = np.load(HERE / "out" / "photo" / "depth.npy").astype(np.float32)
    d = cv2.resize(d, (shape[1], shape[0]))
    d = cv2.GaussianBlur(d, (0, 0), 6)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=5)
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=5)
    k = 18.0 * 960 / shape[1]
    n = np.dstack([-gx * k, -gy * k, np.ones_like(d)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n[..., 0], n[..., 1]


def render_cells(t: np.ndarray, cols: int, G: np.ndarray, g_exp: float, d_exp: float, aspect=ASPECT, full=False):
    H, W = t.shape
    rows = int(round(H / (W / cols * aspect)))
    # sample at 16 px per cell width for accuracy
    sw = cols * 16
    sh = int(round(rows * 16 * aspect))
    L = cv2.resize(t, (sw, sh), interpolation=cv2.INTER_AREA)
    v = sample(L, cols, rows, INNER)
    e = sample(L, cols, rows, OUTER)
    ve = enhance(v, e, g_exp, d_exp)
    d = ((ve[..., None, :] - G[None, None]) ** 2).sum(-1)
    idx = d.argmin(-1)
    lum = v.mean(-1)
    if full:
        return idx, lum, rows, ve
    return idx, lum, rows


def draw(idx, lum, cw=8, bg=(5, 6, 6), label=""):
    rows, cols = idx.shape
    ch = int(round(cw * ASPECT))
    font = ImageFont.truetype(str(FONT), int(round(cw / 0.6)))
    img = Image.new("RGB", (cols * cw, rows * ch + (28 if label else 0)), bg)
    dr = ImageDraw.Draw(img)
    for y in range(rows):
        for x in range(cols):
            c = CHARS[idx[y, x]]
            if c == " ":
                continue
            b = float(np.clip(0.12 + 1.0 * lum[y, x] ** 1.1, 0, 1))
            col = tuple(int(bg[k] + (244 - bg[k]) * b) for k in range(3))
            dr.text((x * cw + cw / 2, y * ch + ch * 0.54), c, font=font, fill=col, anchor="mm")
    if label:
        dr.text((8, rows * ch + 6), label, font=ImageFont.truetype(str(FONT), 16), fill=(166, 174, 177))
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--cols", type=int, nargs="+", default=[110])
    ap.add_argument("--g", type=float, default=1.8)
    ap.add_argument("--d", type=float, default=2.6)
    ap.add_argument("--gamma", type=float, default=1.15)
    ap.add_argument("--curve", type=float, default=0.45)
    ap.add_argument("--tag", default="")
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()
    global GAMMA, CURVE
    GAMMA, CURVE = a.gamma, a.curve
    OUT.mkdir(parents=True, exist_ok=True)
    t, info = prepare(Path(a.src))
    box = crop_box(t, info)
    nx, ny = normals(t.shape)
    t, nx, ny = apply_box(t, box), apply_box(nx, box), apply_box(ny, box)
    Image.fromarray((t * 255).astype(np.uint8)).save(OUT / "source.png")
    np.save(OUT / "source.npy", t)
    G = glyph_vectors()
    for cols in a.cols:
        idx, lum, rows = render_cells(t, cols, G, a.g, a.d)
        draw(idx, lum, cw=8, label=f"{cols} cols {a.tag}").save(OUT / f"ascii-{cols}{a.tag}.png")
        print(cols, rows)
    if a.publish:
        publish(t, nx, ny, a.cols[0], G, a.g, a.d)


def publish(t, nx, ny, cols, G, g_exp, d_exp) -> None:
    """public/field/maps.webp for src/three/grid.ts, plus the glyph table, still size and terminal face."""
    idx, lum, rows, ve = render_cells(t, cols, G, g_exp, d_exp, full=True)
    small = lambda arr: cv2.resize(arr.astype(np.float32), (cols, rows), interpolation=cv2.INTER_AREA)
    q = lambda arr: np.clip(np.round(arr * 255), 0, 255).astype(np.uint8)
    occupied = idx > 0
    ve = ve * occupied[..., None]
    b0 = q(ve[..., 0:3])
    b1 = q(ve[..., 3:6])
    b2 = np.dstack([q(lum * occupied), q(small(nx) * 0.5 + 0.5), q(small(ny) * 0.5 + 0.5)])
    rgb = np.concatenate([b0, b1, b2], 0)
    img = Image.fromarray(rgb, "RGB")
    img.save(ROOT / "public" / "field" / "maps.webp", "WEBP", lossless=True, quality=100, method=6)
    meta_p = ROOT / "src" / "data" / "field-meta.json"
    meta = {
        "format": "shape6: rows 0..R-1 = circle samples 0-2, R..2R-1 = samples 3-5, 2R..3R-1 = lum, normal x, normal y",
        "maps": [cols, rows],
        "aspect": rows * ASPECT / cols,
        "still": [640, round(640 * rows * ASPECT / cols)],
        "chars": CHARS,
        "ramp": "`':;!=r*xoa2%#&@",   # the brightness ramp the 3D project figures use (src/three/works)
        "glyphs": [int(round(x * 255)) for x in G.ravel()],
        "count": int(occupied.sum()),
    }
    meta_p.write_text(json.dumps(meta, separators=(",", ":")) + NL, encoding="utf-8", newline=NL)
    # terminal `whoami --face`: shape-matched too, 92 columns, cells twice as tall as wide
    tidx, _, trows = render_cells(t, 92, G, g_exp, d_exp, aspect=2.0)
    lines = ["".join(CHARS[i] for i in row).rstrip() for row in tidx]
    while lines and not lines[-1]:
        lines.pop()
    while lines and not lines[0]:
        lines.pop(0)
    (ROOT / "src" / "data" / "portrait-ascii.txt").write_text(NL.join(lines) + NL, encoding="utf-8", newline=NL)
    print("published maps.webp", (cols, rows), "occupied", int(occupied.sum()))


if __name__ == "__main__":
    main()
