"""ASCII *character* portrait versions (Phase A review).

Idea: draw a clean, stylised illustration of Kartik from his own geometry (MediaPipe landmarks from all
photos + dark-pixel masks for hair, brows, beard taken from the primary photo), then turn that
illustration into ASCII by *shape matching* each cell against real JetBrains Mono glyphs.
Because the illustration is clean, the glyph choice follows real contours instead of photo noise.

Styles:
  ink        line portrait: outlines, hair strands, beard stipple, almost no fill
  cel        comic cel shading: 3 flat skin bands, solid hair, bold outline
  character  gentle caricature: landmark warp (bigger eyes, smaller jaw), chunky cells, cel shading
  relief     dense shape-matched glyphs with depth lighting (3D volume)

Inputs : scripts/portrait/out/{primary.npz, structure.npz, primary-depth.npy} + the primary photo (read only)
Outputs: scripts/portrait/out/versions/<style>/{portrait.txt, portrait.png, cells.json} (gitignored)

Run: PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/character.py --primary ../image.png --style all
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
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "out"
VER = OUT / "versions"
ROOT = HERE.parent.parent
FONT_PATH = ROOT / "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff"

CELL_W, CELL_H = 12, 20          # glyph raster at 20px font, line-height 1.0 (aspect 1.667)
PATCH_W, PATCH_H = 6, 10         # matching resolution per cell
WORK_W = 960                     # illustration width in px

# ---- landmark index sets (MediaPipe Face Mesh, image-left = subject's right) ----------------------
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
        176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYE_R = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
EYE_L = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
BROW_R = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
BROW_L = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
LIP_UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LIP_LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
NOSE_BASE = [129, 64, 98, 97, 2, 326, 327, 294, 358]
NOSTRIL_R, NOSTRIL_L = [79, 166, 75, 60, 20, 238], [309, 392, 305, 290, 250, 458]
NOSE_BRIDGE = [168, 6, 197, 195, 5]
IRIS_R, IRIS_L = 468, 473
KEYPOINTS = {"eye_r_out": 33, "eye_r_in": 133, "eye_l_in": 362, "eye_l_out": 263, "brow_r": 105, "brow_l": 334,
             "nose_tip": 1, "mouth_r": 61, "mouth_l": 291, "chin": 152, "iris_r": 468, "iris_l": 473}

# per-cell classes (also used for colour and animation order in the preview)
BG, SKIN, HAIR, BEARD, BROW, EYE, IRIS, LIP, LINE, SHIRT, EAR = range(11)
CLASS_NAMES = ["bg", "skin", "hair", "beard", "brow", "eye", "iris", "lip", "line", "shirt", "ear"]


# ---------------------------------------------------------------------------------------------------
# 1. geometry + region masks from the photo
# ---------------------------------------------------------------------------------------------------
def poly_mask(shape, pts, idx) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(pts[idx]).astype(np.int32)], 255)
    return m > 0


def largest(mask: np.ndarray, keep=1) -> np.ndarray:
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return mask
    order = np.argsort(-stats[1:, cv2.CC_STAT_AREA])[:keep] + 1
    return np.isin(lab, order)


def smooth_mask(mask: np.ndarray, r: float) -> np.ndarray:
    return cv2.GaussianBlur(mask.astype(np.float32), (0, 0), r) > 0.5


def build_base(primary: Path) -> dict:
    img = cv2.imread(str(primary))
    P = np.load(OUT / "primary.npz")
    S = np.load(OUT / "structure.npz")
    lm, pmask, M = P["landmarks"], P["mask"], P["M"]
    depth = np.load(OUT / "primary-depth.npy")
    Minv = cv2.invertAffineTransform(M)
    mean_in_primary = cv2.transform(S["mean_shape"][None].astype(np.float32), Minv)[0]
    shape = 0.75 * lm + 0.25 * mean_in_primary

    # crop: head + top of shoulders, 4:5, hair top from the person mask
    h, w = img.shape[:2]
    face_top, chin = lm[:, 1].min(), lm[152, 1]
    face_h = chin - face_top
    cols = np.where(pmask[: int(face_top)].max(axis=0) > 0.5)[0] if face_top > 2 else []
    rows_m = np.where((pmask > 0.5).any(axis=1))[0]
    hair_top = rows_m.min() if len(rows_m) else face_top - face_h * 0.6
    cx = (lm[234, 0] + lm[454, 0]) / 2
    y0 = max(0, int(hair_top - face_h * 0.10))
    y1 = min(h, int(chin + face_h * 0.42))
    ch = y1 - y0
    cw = int(ch * 0.82)
    x0 = int(max(0, min(w - cw, cx - cw / 2)))
    sl = (slice(y0, y1), slice(x0, x0 + cw))
    s = WORK_W / cw
    H = int(round(ch * s))
    rs = lambda a, interp=cv2.INTER_CUBIC: cv2.resize(a[sl], (WORK_W, H), interpolation=interp)
    bgr = rs(img)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    person = smooth_mask(rs(pmask, cv2.INTER_LINEAR) > 0.5, 3)
    dep = rs(depth.astype(np.float32), cv2.INTER_LINEAR)
    pts = (shape - np.array([x0, y0], np.float32)) * s
    lm_c = (lm - np.array([x0, y0], np.float32)) * s
    shp = gray.shape

    face = poly_mask(shp, pts, OVAL)
    eye_r, eye_l = poly_mask(shp, pts, EYE_R), poly_mask(shp, pts, EYE_L)
    lips = poly_mask(shp, pts, LIPS)
    brow_y = min(pts[105, 1], pts[334, 1])
    eye_y = (pts[159, 1] + pts[386, 1]) / 2
    nose_y = pts[2, 1]
    mouth_y = (pts[61, 1] + pts[291, 1]) / 2
    chin_y = pts[152, 1]
    face_w = pts[454, 0] - pts[234, 0]
    yy, xx = np.mgrid[0:shp[0], 0:shp[1]].astype(np.float32)

    # skin reference: cheeks
    cheek = face & (yy > eye_y + 0.05 * face_w) & (yy < nose_y) & ~eye_r & ~eye_l
    skin_med = float(np.median(gray[cheek]))
    blur = cv2.GaussianBlur(gray, (0, 0), 1.5)

    # hair: dark pixels in the person mask, above the ears/brows or outside the face oval at top
    dark = blur < min(0.42, skin_med * 0.62)
    head_zone = (yy < pts[234, 1] + 0.1 * face_w) | ((yy < eye_y) & ~face)
    hair = person & dark & head_zone & ~(face & (yy > brow_y - 0.02 * face_w))
    hair = cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
    hair = largest(hair) & person
    hair = smooth_mask(hair, 4)

    # brows: dark pixels near the landmark brow polygons (true shape from the photo)
    brow_poly = poly_mask(shp, pts, BROW_R) | poly_mask(shp, pts, BROW_L)
    near_brow = cv2.dilate(brow_poly.astype(np.uint8), np.ones((int(face_w * 0.06),) * 2, np.uint8)) > 0
    brows = near_brow & (blur < skin_med * 0.72)
    brows = largest(cv2.morphologyEx(brows.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0, 2)
    brows = smooth_mask(brows | brow_poly, 2)

    # beard + moustache: pixels darker than their *local* skin (ratio to a wide blur), so jaw shading
    # on the right cheek is not mistaken for beard and the lighter left jaw is not missed
    local = cv2.GaussianBlur(np.where(person, gray, skin_med).astype(np.float32), (0, 0), face_w * 0.09)
    ratio = blur / (local + 1e-3)
    lower = (yy > nose_y + 0.015 * face_w)
    jaw_band = cv2.dilate(face.astype(np.uint8), np.ones((int(face_w * 0.07),) * 2, np.uint8)) > 0
    beard = lower & jaw_band & person & ((ratio < 0.80) | (blur < skin_med * 0.55)) & ~lips
    beard = cv2.morphologyEx(beard.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    beard = cv2.morphologyEx(beard, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)) > 0
    n, lab_, st, _ = cv2.connectedComponentsWithStats(beard.astype(np.uint8), 8)
    keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > (face_w * 0.03) ** 2]
    beard = np.isin(lab_, keep)
    beard = smooth_mask(beard, 3) & ~lips
    ratio_map = ratio

    # ears: person, not hair, beside the face between brow and mouth height
    ears = person & ~face & ~hair & (yy > brow_y) & (yy < mouth_y) & \
        ((xx < pts[234, 0] + 4) | (xx > pts[454, 0] - 4)) & (np.abs(xx - (pts[234, 0] + pts[454, 0]) / 2) < face_w * 0.68)
    ears = smooth_mask(largest(ears, 2), 2)

    # neck + shirt below the face: skin hue vs low-saturation shirt
    body = person & ~face & ~hair & ~ears & (yy > mouth_y)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    skinlike = (lab[..., 1] >= 138) & (lab[..., 2] >= 142)
    neck = body & skinlike & (np.abs(xx - pts[152, 0]) < face_w * 0.42)
    neck = cv2.morphologyEx(neck.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    neck = cv2.morphologyEx(neck, cv2.MORPH_OPEN, np.ones((41, 41), np.uint8)) > 0
    neck = smooth_mask(largest(neck), 6) | (body & (yy < chin_y + 0.08 * face_w) & (np.abs(xx - pts[152, 0]) < face_w * 0.3))
    shirt = smooth_mask(body & ~neck & ~beard, 3)
    skin = person & ~hair & ~shirt
    halo = (cv2.dilate(hair.astype(np.uint8), np.ones((17, 17), np.uint8)) > 0) &         ~(cv2.dilate(face.astype(np.uint8), np.ones((61, 61), np.uint8)) > 0)
    skin &= ~halo
    person = person & ~(halo & ~hair)

    # depth -> normals (Depth Anything gives relative inverse depth: larger = closer)
    d = cv2.GaussianBlur(dep, (0, 0), 6)
    inside = person
    lo, hi = np.percentile(d[inside], [2, 98])
    d = np.clip((d - lo) / (hi - lo + 1e-6), 0, 1)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=5)
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=5)
    k = 18.0
    nrm = np.dstack([-gx * k, -gy * k, np.ones_like(d)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)

    return dict(bgr=bgr, gray=gray, blur=blur, person=person, face=face, hair=hair, brows=brows, beard=beard, ears=ears,
                neck=neck, shirt=shirt, skin=skin, eye_r=eye_r, eye_l=eye_l, lips=lips, pts=pts, lm=lm_c, depth=d, normal=nrm,
                skin_med=skin_med, face_w=face_w, ratio=ratio_map, H=H, W=WORK_W)


def debug_regions(B: dict) -> np.ndarray:
    H, W = B["H"], B["W"]
    out = np.zeros((H, W, 3), np.uint8)
    colors = [("skin", (70, 140, 200)), ("shirt", (90, 90, 160)), ("neck", (60, 120, 200)), ("ears", (60, 160, 220)), ("face", (80, 170, 230)),
              ("hair", (200, 40, 200)), ("beard", (30, 80, 30)), ("brows", (0, 0, 255)), ("lips", (120, 80, 220)),
              ("eye_r", (255, 255, 255)), ("eye_l", (255, 255, 255))]
    for k, c in colors:
        out[B[k]] = c
    g = (B["gray"] * 255).astype(np.uint8)
    out = cv2.addWeighted(out, 0.65, cv2.cvtColor(g, cv2.COLOR_GRAY2BGR), 0.35, 0)
    for x, y in B["pts"][list(KEYPOINTS.values())].astype(int):
        cv2.circle(out, (int(x), int(y)), 4, (0, 255, 0), -1)
    return out



# ---------------------------------------------------------------------------------------------------
# 2. drawing helpers
# ---------------------------------------------------------------------------------------------------
def orientation(gray: np.ndarray, sigma=10.0) -> np.ndarray:
    """Local stroke direction (radians, along the strands) from the structure tensor."""
    g = cv2.GaussianBlur(gray, (0, 0), 1.5)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), sigma)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), sigma)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), sigma)
    return 0.5 * np.arctan2(2 * jxy, jxx - jyy) + np.pi / 2


def strands(canvas, region, theta, spacing, length, thick, value, rng, step=3.0):
    """Trace streamlines along `theta` inside `region` and draw them (hair / beard texture)."""
    H, W = region.shape
    lines = []
    for y in np.arange(spacing / 2, H, spacing):
        for x in np.arange(spacing / 2, W, spacing):
            px, py = x + rng.uniform(-spacing / 2, spacing / 2), y + rng.uniform(-spacing / 2, spacing / 2)
            if not (0 <= int(py) < H and 0 <= int(px) < W) or not region[int(py), int(px)]:
                continue
            L = length * rng.uniform(0.6, 1.2)
            pts = [(px, py)]
            for sgn in (1, -1):
                cx, cy, prev = px, py, None
                seg = []
                for _ in range(int(L / step / 2)):
                    a = theta[int(cy), int(cx)]
                    dx, dy = np.cos(a), np.sin(a)
                    if prev is not None and dx * prev[0] + dy * prev[1] < 0:
                        dx, dy = -dx, -dy
                    prev = (dx, dy)
                    cx, cy = cx + sgn * dx * step, cy + sgn * dy * step
                    if not (0 <= int(cy) < H and 0 <= int(cx) < W) or not region[int(cy), int(cx)]:
                        break
                    seg.append((cx, cy))
                pts = (seg[::-1] + pts) if sgn == -1 else (pts + seg)
            if len(pts) > 3:
                lines.append(np.array(pts, np.float32))
    for ln in lines:
        cv2.polylines(canvas, [np.round(ln * 4).astype(np.int32)], False, float(value), thick, cv2.LINE_AA, shift=2)
    return canvas


def contour_lines(canvas, mask, thick, value, min_len=40):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for c in cs:
        if len(c) >= min_len:
            c = cv2.approxPolyDP(c, 1.2, True)
            cv2.polylines(canvas, [c], True, float(value), thick, cv2.LINE_AA)


def pl(canvas, pts, idx, thick, value, closed=False):
    cv2.polylines(canvas, [np.round(pts[idx] * 4).astype(np.int32)], closed, float(value), thick, cv2.LINE_AA, shift=2)


def shading(B: dict, light=(-0.55, -0.45, 0.7)) -> np.ndarray:
    L = np.array(light, np.float32)
    L /= np.linalg.norm(L)
    lam = np.clip((B["normal"] * L).sum(axis=2), 0, 1)
    photo = cv2.GaussianBlur(B["gray"], (0, 0), 6) / (B["skin_med"] + 1e-3)
    sh = 0.45 * (lam - lam[B["skin"]].mean() + 0.6) + 0.55 * np.clip(photo * 0.62, 0, 1.2)
    return np.clip(sh, 0, 1)


def warp_character(B: dict) -> dict:
    """Gentle caricature: eyes +12%, lower face narrowed 6%, jaw slightly shorter. Smooth RBF-style field."""
    pts = B["pts"].copy()
    dst = pts.copy()
    fw = B["face_w"]
    for eye, iris in ((EYE_R, IRIS_R), (EYE_L, IRIS_L)):
        idx = list(eye) + list(range(iris, iris + 5))
        c = pts[eye].mean(axis=0)
        dst[idx] = c + (pts[idx] - c) * 1.2
    cx, nose_y = pts[1, 0], pts[2, 1]
    low = pts[:, 1] > nose_y
    dst[low, 0] = cx + (pts[low, 0] - cx) * 0.92
    dst[low, 1] = nose_y + (pts[low, 1] - nose_y) * 0.95
    H, W = B["H"], B["W"]
    gy, gx = np.mgrid[0:H:60, 0:W:60]
    anchors = np.stack([gx.ravel(), gy.ravel()], 1).astype(np.float32)
    far = np.min(np.linalg.norm(anchors[:, None] - pts[None, ::4], axis=2), axis=1) > fw * 0.18
    anchors = anchors[far]
    src_all = np.vstack([dst, anchors])
    off = np.vstack([pts - dst, np.zeros_like(anchors)])  # inverse map: dst pixel -> src pixel offset
    sig = fw * 0.07
    ys, xs = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
    q = np.stack([xs.ravel(), ys.ravel()], 1)
    acc = np.zeros_like(q)
    wsum = np.zeros(len(q), np.float32)
    for i in range(0, len(src_all), 64):
        d2 = ((q[:, None, :] - src_all[None, i:i + 64]) ** 2).sum(-1)
        w = np.exp(-d2 / (2 * sig * sig))
        acc += w @ off[i:i + 64]
        wsum += w.sum(1)
    field = (acc / (wsum[:, None] + 1e-4)).reshape(xs.shape + (2,))
    fx = cv2.resize(field[..., 0], (W, H), interpolation=cv2.INTER_LINEAR)
    fy = cv2.resize(field[..., 1], (W, H), interpolation=cv2.INTER_LINEAR)
    YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
    mx, my = XX + fx, YY + fy
    W2 = dict(B)
    for k in ("gray", "blur", "depth", "ratio"):
        W2[k] = cv2.remap(B[k].astype(np.float32), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    W2["normal"] = cv2.remap(B["normal"].astype(np.float32), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    for k in ("person", "face", "hair", "brows", "beard", "ears", "neck", "shirt", "skin"):
        W2[k] = cv2.remap(B[k].astype(np.float32), mx, my, cv2.INTER_LINEAR) > 0.5
    W2["pts"] = dst
    W2["eye_r"], W2["eye_l"] = poly_mask((H, W), dst, EYE_R), poly_mask((H, W), dst, EYE_L)
    W2["lips"] = poly_mask((H, W), dst, LIPS)
    return W2


# ---------------------------------------------------------------------------------------------------
# 3. the illustration
#    `line`  thin strokes (about one glyph stroke wide): outlines, features, hair strands, beard strokes
#    plus semantic masks for flat fills (hair, beard, brows, iris, skin bands) and a positive tone field.
# ---------------------------------------------------------------------------------------------------
STYLE = {
    "ink":       dict(cols=96, line=1.0, hair_sp=2.8, hair_len=12, warp=False),
    "cel":       dict(cols=96, line=1.0, hair_sp=3.4, hair_len=12, warp=False),
    "character": dict(cols=64, line=1.3, hair_sp=4.0, hair_len=9, warp=True),
    "relief":    dict(cols=120, line=0.9, hair_sp=3.0, hair_len=12, warp=False),
}
# flat fill glyphs (ordered by measured coverage, see glyph_atlas): cel = comic bands, character = chunkier
FILLS = {
    "ink":       {"hair": " ", "hair_dk": " ", "beard": ",", "brow": "=", "iris": "@", "skin": [".", " ", " "], "shirt": " "},
    "cel":       {"hair": ":", "hair_dk": "+", "beard": ";", "brow": "#", "iris": "@", "skin": [":", ".", " "], "shirt": " "},
    "character": {"hair": "%", "hair_dk": "#", "beard": "%", "brow": "#", "iris": "@", "skin": [".", " ", " "], "shirt": " "},
}


def illustrate(B: dict, style: str, seed=7) -> dict:
    cfg = STYLE[style]
    rng = np.random.default_rng(seed)
    H, W = B["H"], B["W"]
    pts = B["pts"]
    fw = B["face_w"]
    cell = W / cfg["cols"]
    lw = max(2, int(round(cell * 0.24 * cfg["line"])))
    line = np.zeros((H, W), np.float32)

    # silhouette and inner outlines
    contour_lines(line, B["person"], lw, 1.0)
    contour_lines(line, B["hair"], lw, 1.0)
    contour_lines(line, B["ears"], lw, 1.0)
    neck = B["neck"].astype(np.uint8)
    cs, _ = cv2.findContours(neck, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if cs:
        hull = cv2.convexHull(max(cs, key=cv2.contourArea))
        hm = np.zeros((H, W), np.uint8)
        cv2.fillPoly(hm, [hull], 1)
        contour_lines(line, (hm > 0) & ~B["beard"] & B["person"], lw, 1.0)
    jaw = OVAL[OVAL.index(454):OVAL.index(234) + 1]
    pl(line, pts, jaw, lw, 1.0)

    # hair strands follow the real flow of his hair, spaced ~2 cells so each reads as its own glyph line
    theta = orientation(B["gray"], 18)
    inner = cv2.erode(B["hair"].astype(np.uint8), np.ones((int(cell),) * 2, np.uint8)) > 0
    strands(line, inner, theta, cell * cfg["hair_sp"], cell * cfg["hair_len"], lw, 1.0, rng)

    # beard + moustache: the outline gives the shape (goatee, moustache); the inside is a flat fill
    contour_lines(line, smooth_mask(B["beard"], 4), lw, 1.0, min_len=20)

    # brows: two or three strokes along their length (thick, straight brows)
    for brow in (BROW_R, BROW_L):
        up, lo = pts[brow[:5]], pts[brow[5:]][::-1]
        for t in (0.25, 0.6, 0.9):
            c = up * (1 - t) + lo * t
            cv2.polylines(line, [np.round(c * 4).astype(np.int32)], False, 1.0, lw, cv2.LINE_AA, shift=2)

    # eyes: strong upper lid (lash line), light lower lid
    for eye in (EYE_R, EYE_L):
        pl(line, pts, eye[:9], int(round(lw * 1.5)), 1.0)
        pl(line, pts, eye[8:] + [eye[0]], lw, 0.8)
    # nose: base curve + nostrils
    pl(line, pts, NOSE_BASE, lw, 1.0)
    for nos in (NOSTRIL_R, NOSTRIL_L):
        c = pts[nos].mean(axis=0)
        cv2.ellipse(line, (int(c[0]), int(c[1])), (int(fw * 0.022), int(fw * 0.010)), 0, 0, 360, 1.0, -1, cv2.LINE_AA)
    # mouth: parting line, centre of the upper lip, short lower-lip shadow
    mouth = (pts[LIP_UP_IN] + pts[LIP_LO_IN]) / 2
    cv2.polylines(line, [np.round(mouth * 4).astype(np.int32)], False, 1.0, int(round(lw * 1.3)), cv2.LINE_AA, shift=2)
    pl(line, pts, [84, 17, 314], lw, 0.8)

    # keep everything off the crop border (no frame lines)
    mrg = int(cell * 1.5)
    for arr in (line,):
        arr[:, :mrg] = 0
        arr[:, -mrg:] = 0
        arr[-mrg:, :] = 0

    # semantic masks and bands
    sh = shading(B)
    skin = B["skin"] & ~B["beard"] & ~B["brows"] & ~B["eye_r"] & ~B["eye_l"]
    band = np.digitize(sh, [0.45, 0.63])           # 0 shadow, 1 mid, 2 lit
    hair_dk = B["hair"] & (B["blur"] < np.percentile(B["blur"][B["hair"]], 45))
    iris = np.zeros((H, W), bool)
    for eye, ir in ((EYE_R, IRIS_R), (EYE_L, IRIS_L)):
        c = pts[ir]
        r = float(np.linalg.norm(pts[ir + 1] - c)) * 0.72
        m = np.zeros((H, W), np.uint8)
        cv2.circle(m, (int(round(c[0])), int(round(c[1]))), int(round(r)), 1, -1)
        iris |= (m > 0) & poly_mask((H, W), pts, eye)

    # positive tone (relief): lit = denser, so the face keeps its volume on the dark page
    lam = np.clip((B["normal"] * np.array([-0.5, -0.45, 0.74])).sum(2), 0, 1)
    tone = np.zeros((H, W), np.float32)
    lit = np.clip(0.55 * sh + 0.45 * lam, 0, 1)
    tone = np.where(skin | B["ears"], 0.05 + 0.22 * lit, tone)
    tone = np.where(B["shirt"], 0.03 + 0.07 * lam, tone)
    tone = np.where(B["hair"], 0.045, tone)
    tone = np.where(B["beard"], 0.05, tone)
    tone = np.where(B["eye_r"] | B["eye_l"], 0.22, tone)
    tone = np.where(iris, 0.0, tone)
    tone = np.where(B["brows"], 0.03, tone).astype(np.float32)
    tone[~B["person"]] = 0
    return dict(line=np.clip(line, 0, 1), skin=skin, band=band, hair=B["hair"], hair_dk=hair_dk, beard=B["beard"],
                brows=B["brows"], iris=iris, eyes=B["eye_r"] | B["eye_l"], shirt=B["shirt"], ears=B["ears"],
                person=B["person"], lips=B["lips"], tone=tone)


# ---------------------------------------------------------------------------------------------------
# 4. glyph atlas + shape matching
# ---------------------------------------------------------------------------------------------------
LINE_SET = " .,'`-_~:;!|/\\()<>^\"=+*"
FULL_SET = "".join(chr(c) for c in range(32, 127))
RAMP = " .,:;~=+*"   # measured-coverage ramp for the relief shading (punctuation reads as tone, not text)


def glyph_atlas(chars: str) -> tuple[np.ndarray, np.ndarray]:
    font = ImageFont.truetype(str(FONT_PATH), 20)
    vecs, cov = [], []
    for ch in chars:
        im = Image.new("L", (CELL_W, CELL_H), 0)
        ImageDraw.Draw(im).text((0, -4), ch, font=font, fill=255)
        a = np.asarray(im, np.float32) / 255
        cov.append(a.mean())
        vecs.append(cv2.resize(a, (PATCH_W, PATCH_H), interpolation=cv2.INTER_AREA).ravel())
    return np.array(vecs), np.array(cov)


def to_patches(img: np.ndarray, cols: int, rows: int) -> np.ndarray:
    small = cv2.resize(img.astype(np.float32), (cols * PATCH_W, rows * PATCH_H), interpolation=cv2.INTER_AREA)
    return small.reshape(rows, PATCH_H, cols, PATCH_W).transpose(0, 2, 1, 3).reshape(rows * cols, -1)


def nearest(patches: np.ndarray, chars: str) -> np.ndarray:
    G, _ = glyph_atlas(chars)
    d = (patches ** 2).sum(1)[:, None] - 2 * patches @ G.T + (G ** 2).sum(1)[None]
    return np.array(list(chars))[np.argmin(d, axis=1)]


def grid_size(B, cols):
    return int(round(B["H"] / (B["W"] / cols * CELL_H / CELL_W)))


def compose(B: dict, L: dict, style: str) -> tuple[np.ndarray, np.ndarray]:
    cols = STYLE[style]["cols"]
    rows = grid_size(B, cols)
    rs = lambda a: cv2.resize(np.asarray(a, np.float32), (cols, rows), interpolation=cv2.INTER_AREA)
    lp = to_patches(L["line"], cols, rows)
    line_cov = lp.mean(1).reshape(rows, cols)
    line_ch = nearest(np.clip(lp * 1.1, 0, 1), LINE_SET).reshape(rows, cols)
    grid = np.full((rows, cols), " ", dtype="<U1")
    cls = np.full((rows, cols), BG, np.int32)

    m = {k: rs(L[k]) for k in ("skin", "hair", "hair_dk", "beard", "brows", "iris", "eyes", "shirt", "ears", "person", "lips")}
    band = cv2.resize(L["band"].astype(np.float32), (cols, rows), interpolation=cv2.INTER_NEAREST).astype(int)
    # classes (priority order)
    for c, k, thr in ((SKIN, "skin", 0.4), (EAR, "ears", 0.4), (SHIRT, "shirt", 0.5), (HAIR, "hair", 0.4), (BEARD, "beard", 0.4),
                      (BROW, "brows", 0.35), (LIP, "lips", 0.4), (EYE, "eyes", 0.3), (IRIS, "iris", 0.12)):
        cls[m[k] > thr] = c

    if style == "relief":
        tv = cv2.resize(L["tone"], (cols, rows), interpolation=cv2.INTER_AREA)
        _, cov = glyph_atlas(RAMP)
        idx = np.abs(tv[..., None] - cov[None, None]).argmin(-1)
        grid = np.array(list(RAMP))[idx]
        grid[cls == IRIS] = "@"
    else:
        F = FILLS[style]
        grid[cls == HAIR] = F["hair"]
        grid[(cls == HAIR) & (m["hair_dk"] > 0.5)] = F["hair_dk"]
        grid[cls == BEARD] = F["beard"]
        grid[cls == BROW] = F["brow"]
        for b in range(3):
            grid[((cls == SKIN) | (cls == EAR)) & (band == b)] = F["skin"][b]
        grid[cls == SHIRT] = F["shirt"]
        grid[cls == IRIS] = F["iris"]
    # line glyphs on top wherever a stroke passes through the cell (iris keeps its dot)
    use_line = (line_cov > 0.07) & (line_ch != " ") & (cls != IRIS)
    if style == "ink":
        use_line |= (line_cov > 0.04) & (line_ch != " ") & (cls != IRIS)
    grid[use_line] = line_ch[use_line]
    cls_out = cls.copy()
    cls_out[use_line & ~np.isin(cls, [EYE, BROW, LIP])] = LINE
    grid[m["person"] < 0.15] = np.where(use_line, grid, " ")[m["person"] < 0.15]
    return grid, cls_out


# ---------------------------------------------------------------------------------------------------
# 5. animation order + outputs
# ---------------------------------------------------------------------------------------------------
def anim_order(style, cls, rows, cols, rng):
    yy, xx = np.mgrid[0:rows, 0:cols].astype(np.float32)
    cx, cy = cols / 2, rows * 0.45
    ang = (np.arctan2(yy - cy, xx - cx) + np.pi * 1.5) % (2 * np.pi) / (2 * np.pi)
    if style == "ink":   # outline -> hair -> brows + eyes -> nose + mouth -> beard -> skin
        base = {LINE: 0.0, EAR: 0.05, SHIRT: 0.05, HAIR: 0.25, BROW: 0.48, EYE: 0.54, IRIS: 0.6, LIP: 0.66, BEARD: 0.74, SKIN: 0.84, BG: 0.0}
        span = {LINE: 0.25, EAR: 0.2, SHIRT: 0.2, HAIR: 0.22, BROW: 0.08, EYE: 0.08, IRIS: 0.05, LIP: 0.08, BEARD: 0.12, SKIN: 0.14, BG: 0.2}
        prog = np.where(np.isin(cls, [LINE, EAR, SHIRT, BG]), ang, xx / cols)
        prog = np.where(cls == HAIR, 1 - yy / rows, prog)
        o = np.vectorize(base.get)(cls) + np.vectorize(span.get)(cls) * prog
    elif style == "cel":   # light bands settle first, dark masses next, outline snaps in last
        tier = np.select([cls == LINE, np.isin(cls, [HAIR, BEARD, BROW]), np.isin(cls, [EYE, IRIS, LIP])], [0.8, 0.45, 0.65], 0.15)
        o = tier + 0.18 * rng.random((rows, cols))
    elif style == "character":
        o = 0.65 * (yy / rows) + 0.25 * rng.random((rows, cols))
    else:
        o = xx / cols * 0.9 + 0.05 * rng.random((rows, cols))
    o = (o - o.min()) / (o.max() - o.min() + 1e-6)
    return np.round(o * 99).astype(int)


COLORS = {BG: (124, 255, 138), SKIN: (86, 170, 98), HAIR: (124, 255, 138), BEARD: (124, 255, 138), BROW: (150, 255, 160),
          EYE: (210, 250, 205), IRIS: (255, 180, 84), LIP: (210, 250, 205), LINE: (180, 255, 186), SHIRT: (86, 170, 98), EAR: (86, 170, 98)}


def render_png(lines, cls, scale=1.0) -> Image.Image:
    font = ImageFont.truetype(str(FONT_PATH), int(round(20 * scale)))
    cw, chh = CELL_W * scale, CELL_H * scale
    W, H = int(cw * max(len(l) for l in lines)) + 32, int(chh * len(lines)) + 32
    img = Image.new("RGB", (W, H), (11, 15, 12))
    dr = ImageDraw.Draw(img)
    for y, line in enumerate(lines):
        for x, ch in enumerate(line):
            if ch != " ":
                dr.text((16 + x * cw, 16 + y * chh - 4 * scale), ch, font=font, fill=COLORS[int(cls[y, x])])
    return img


def run_style(B0: dict, style: str) -> dict:
    cfg = STYLE[style]
    B = warp_character(B0) if cfg["warp"] else B0
    L = illustrate(B, style)
    grid, cls = compose(B, L, style)
    rows, cols = grid.shape
    order = anim_order(style, cls, rows, cols, np.random.default_rng(3))
    lines = ["".join(r) for r in grid]
    nonempty = [i for i, l in enumerate(lines) if l.strip()]
    r0, r1 = nonempty[0], nonempty[-1] + 1
    lines, cls, order = lines[r0:r1], cls[r0:r1], order[r0:r1]
    depth = cv2.resize(B["depth"].astype(np.float32), (cols, rows), interpolation=cv2.INTER_AREA)[r0:r1]
    d = VER / style
    d.mkdir(parents=True, exist_ok=True)
    (d / "portrait.txt").write_text("\n".join(l.rstrip() for l in lines) + "\n", encoding="utf-8", newline="\n")
    render_png(lines, cls).save(d / "portrait.png")
    cv2.imwrite(str(d / "line.png"), (L["line"] * 255).astype(np.uint8))
    data = {"style": style, "cols": cols, "rows": len(lines), "cell": [CELL_W, CELL_H],
            "chars": lines, "cls": ["".join("0123456789a"[c] for c in r) for r in cls],
            "order": order.ravel().tolist(), "depth": np.round(np.clip(depth, 0, 1) * 99).astype(int).ravel().tolist(),
            "classes": CLASS_NAMES}
    (d / "cells.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    sx, sy = cols / B["W"], rows / B["H"]
    kp = {k: [float(B["pts"][i, 0] * sx), float(B["pts"][i, 1] * sy - r0)] for k, i in KEYPOINTS.items()}
    (d / "keypoints.json").write_text(json.dumps(kp, indent=1), encoding="utf-8")
    print(f"{style:10s} {cols}x{len(lines)} cells")
    return {"lines": lines, "cls": cls, "kp": kp}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--primary", required=True)
    ap.add_argument("--style", default="all", choices=["all", *STYLE])
    ap.add_argument("--debug-regions", action="store_true")
    a = ap.parse_args()
    VER.mkdir(parents=True, exist_ok=True)
    B = build_base(Path(a.primary))
    if a.debug_regions:
        cv2.imwrite(str(VER / "regions.png"), debug_regions(B))
        return
    for st in (STYLE if a.style == "all" else [a.style]):
        run_style(B, st)


if __name__ == "__main__":
    main()
