"""Micro-glyph 3D portrait: Kartik's real face as a point cloud of tiny glyphs.

Each point = one glyph cell sampled from the toned photo, lifted into 3D by the Depth Anything map.
Glyph = measured-coverage ramp index (bright skin = denser glyph). Extra channels: rim light (silhouette
edge facing the key light) and a feature weight (eyes, brows, mouth) used to keep those crisp.

Reuses build_base() from character.py (crop, person mask, landmarks, depth, normals).
Output (gitignored): scripts/portrait/out/micro/points.bin + points.json + preview.png
Binary layout per point, little-endian: x, y, z (float16 x3), tone, rim, feat, glyph, rand (uint8 x5)

Run: PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/micro.py --primary ../image.png --cols 200
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import character as C  # noqa: E402
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

OUT = Path(__file__).parent / "out" / "micro"
RAMP = " .'`,:;-~^=+*!?/|(1ilrtfjcvxzunoeas2a%#&@"  # candidates; trimmed to measured, distinct steps below
CELL_ASPECT = 1.6


def measured_ramp(n=16) -> tuple[str, np.ndarray]:
    font = ImageFont.truetype(str(C.FONT_PATH), 40)
    chars = sorted(set(RAMP) - {" "})
    cov = []
    for ch in chars:
        im = Image.new("L", (24, 40), 0)
        ImageDraw.Draw(im).text((0, -8), ch, font=font, fill=255)
        cov.append(np.asarray(im, np.float32).mean() / 255)
    cov = np.array(cov)
    order = np.argsort(cov)
    targets = np.linspace(cov.min(), cov.max(), n)
    picked, used = [], set()
    for t in targets:
        for i in order[np.argsort(np.abs(cov[order] - t))]:
            if chars[i] not in used:
                picked.append(i)
                used.add(chars[i])
                break
    picked = sorted(picked, key=lambda i: cov[i])
    return "".join(chars[i] for i in picked), cov[picked]


def tone_map(B: dict) -> np.ndarray:
    g = (B["gray"] * 255).astype(np.uint8)
    g = cv2.bilateralFilter(g, 7, 30, 5)
    g = cv2.createCLAHE(clipLimit=2.6, tileGridSize=(8, 8)).apply(g)
    t = g.astype(np.float32) / 255
    blur = cv2.GaussianBlur(t, (0, 0), 2.0)
    t = np.clip(t + 0.3 * (t - blur), 0, 1)          # light unsharp: crisper eyes and brows without skin specks
    t = t ** 0.9
    return t


def render_still(xs, ys, tones, rims, glyphs, ramp, cols, rows, cw=8) -> Image.Image:
    """Front view of the field in the site's warm-mono colours with the same soft glow."""
    from PIL import ImageFilter
    ch = cw * CELL_ASPECT
    font = ImageFont.truetype(str(C.FONT_PATH), int(round(cw / 0.6)))
    W, H = int(cols * cw), int(rows * ch)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    paper, amber = np.array([239, 233, 223]), np.array([246, 163, 71])
    for x, y, t, r, g in zip(xs, ys, tones, rims, glyphs):
        e = float(np.clip((t - 0.04) / 0.74, 0, 1))
        lum = 0.12 + 0.88 * e * e * (3 - 2 * e)
        col = paper * lum
        col = col * (1 - min(1, r * 0.55)) + amber * min(1, r * 0.55)
        alpha = float(np.clip(0.35 + 1.1 * t + 0.4 * r, 0, 1))
        dr.text((x * cw, y * ch + ch * 0.5), ramp[g], font=font, anchor="lm", fill=(*[int(c) for c in col], int(alpha * 255)))
    glow = img.filter(ImageFilter.GaussianBlur(cw * 0.9))
    glow.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.55)))
    bg = Image.new("RGBA", (W, H), (11, 10, 18, 255))
    return Image.alpha_composite(Image.alpha_composite(bg, glow), img).convert("RGB")


def studio_maps(B: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Toned portrait (studio look), soft person mask and rim light, at work resolution."""
    H, W = B["H"], B["W"]
    tone = tone_map(B)
    # studio look: shoulders and shirt fall off into the dark, hair gets a lift so the quiff reads
    yy = np.arange(H, dtype=np.float32)[:, None]
    chin = B["pts"][152, 1]
    fall = np.clip(1 - (yy - chin) / (H - chin + 1e-6), 0, 1) ** 1.4
    tone = np.where(yy > chin, tone * (0.25 + 0.75 * fall), tone)
    tone = np.where(B["shirt"], tone * 0.55, tone)
    # hair: lift and cap, but only where the pixel really is dark, so skin caught by the hair mask
    # (top of the forehead, temples) keeps its own tone instead of turning into a flat grey band
    hw = np.clip((B["skin_med"] * 0.85 - B["blur"]) / (B["skin_med"] * 0.25), 0, 1)
    hw = cv2.GaussianBlur(B["hair"].astype(np.float32) * hw, (0, 0), 2)
    tone = tone * (1 - hw) + np.clip(0.10 + tone * 1.1, 0, 0.42) * hw
    # wall showing through the mask edge (grey, no chroma, bright): render it as dark hair, not as a light rim
    lab = cv2.cvtColor(B["bgr"], cv2.COLOR_BGR2LAB).astype(np.float32)
    wall = (lab[..., 1] < 135) & (lab[..., 2] < 140) & (B["blur"] > B["skin_med"] * 0.6) & ~B["face"] & ~B["shirt"]
    ww = cv2.GaussianBlur((wall & B["person"]).astype(np.float32), (0, 0), 3)
    tone = tone * (1 - ww) + 0.16 * ww
    # beard + moustache: follow the hair that is really there (pixels darker than their local skin),
    # not a landmark-shaped mask, so the beard sits where it is in the photo. Shadow on the jaw edge is
    # lighter than real beard relative to its surroundings, so it stays skin.
    L = B["lm"]                                               # this photo's own landmarks (not the averaged shape)
    fw = B["face_w"]
    yy_ = np.arange(H, dtype=np.float32)[:, None]
    xs_ = np.arange(W, dtype=np.float32)[None, :]
    nose_y = float(L[2, 1])
    zone = cv2.dilate(B["face"].astype(np.uint8), np.ones((int(fw * 0.05),) * 2, np.uint8)) > 0
    zone &= (yy_ > nose_y + fw * 0.02) & B["person"] & ~B["lips"]
    hairy = np.clip((0.84 - B["ratio"]) / 0.22, 0, 1) * zone
    bm = cv2.GaussianBlur(cv2.morphologyEx(hairy, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), (0, 0), 3)
    # moustache bridge: find the real moustache line (darkest row above the upper lip in each column) and
    # join its two halves along that line, so the bridge never floats above or below it
    mw = float(np.hypot(*(L[291] - L[61])))
    lip_top = np.interp(xs_[0], L[[61, 40, 37, 0, 267, 270, 291], 0], L[[61, 40, 37, 0, 267, 270, 291], 1])
    line = []
    for x in range(int(L[61, 0]), int(L[291, 0]) + 1):
        y_hi, y_lo = int(lip_top[x] - mw * 0.22), int(lip_top[x] - mw * 0.01)
        col = B["blur"][y_hi:y_lo, x]
        line.append((x, y_hi + int(np.argmin(col)) if len(col) else lip_top[x]))
    line = np.array(line, np.float32)
    k = max(3, int(mw * 0.12)) | 1
    line[:, 1] = np.convolve(np.pad(line[:, 1], k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    bridge = np.zeros((H, W), np.float32)
    cv2.polylines(bridge, [np.round(line * 4).astype(np.int32)], False, 1.0, max(2, int(round(mw * 0.09))), cv2.LINE_AA, shift=2)
    span = np.clip(np.minimum(xs_ - (L[61, 0] + mw * 0.15), (L[291, 0] - mw * 0.15) - xs_) / (mw * 0.12), 0, 1)
    bridge = cv2.GaussianBlur(bridge * span, (0, 0), mw * 0.02) * 0.7
    bm = np.clip(np.maximum(bm, bridge), 0, 1)
    smooth = cv2.GaussianBlur(tone, (0, 0), 3.0)
    # same texture range as the hair, so the beard reads as a beard (visible strokes), not as a hole
    tone = tone * (1 - bm) + np.clip(0.12 + smooth * 0.4, 0.18, 0.38) * bm
    # skin: remove remaining speckle on cheeks and forehead, keep features sharp
    skin = (B["skin"] & ~B["beard"]).astype(np.float32)
    feat0 = np.zeros((H, W), np.float32)
    for k in ("eye_r", "eye_l", "brows", "lips"):
        feat0 = np.maximum(feat0, B[k].astype(np.float32))
    keep_sharp = cv2.GaussianBlur(cv2.dilate(feat0, np.ones((15, 15), np.uint8)), (0, 0), 5)
    soft_skin = cv2.GaussianBlur(tone, (0, 0), 2.2)
    w_s = cv2.GaussianBlur(skin, (0, 0), 3) * (1 - keep_sharp)
    tone = tone * (1 - w_s) + soft_skin * w_s
    person = B["person"].astype(np.float32)
    soft = cv2.GaussianBlur(person, (0, 0), 3)

    # rim light: silhouette band on the side away from the camera-left key light, warm in the shader
    dist = cv2.distanceTransform((person > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    edge = np.clip(1 - dist / (W * 0.018), 0, 1) * (person > 0.5)
    nx = B["normal"][..., 0]
    rim = np.clip(edge * (0.35 + 0.9 * np.clip(nx, 0, 1)) + 0.25 * np.clip(nx - 0.3, 0, 1) * (person > 0.5), 0, 1)
    return tone, soft, rim


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--primary", required=True)
    ap.add_argument("--cols", type=int, default=140)
    ap.add_argument("--publish", action="store_true", help="also write public/field + src/data outputs")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    B = C.build_base(Path(a.primary))
    H, W = B["H"], B["W"]
    tone, soft, rim = studio_maps(B)

    # features to keep crisp (eyes, brows, mouth, nostrils)
    feat = np.zeros((H, W), np.float32)
    for k in ("eye_r", "eye_l", "brows", "lips"):
        feat = np.maximum(feat, B[k].astype(np.float32))
    feat = cv2.GaussianBlur(cv2.dilate(feat, np.ones((9, 9), np.uint8)), (0, 0), 3)

    cols = a.cols
    cell = W / cols
    rows = int(H / (cell * CELL_ASPECT))
    rs = lambda arr: cv2.resize(arr.astype(np.float32), (cols, rows), interpolation=cv2.INTER_AREA)
    T, M, R, F, D = rs(tone), rs(soft), rs(rim), rs(feat), rs(B["depth"])
    ramp, cov = measured_ramp(16)

    # tone -> glyph: keep a floor inside the silhouette so dark hair/beard still read as glyphs
    v = np.clip(0.08 + 0.92 * T, 0, 1)
    v = np.where(M > 0.5, np.maximum(v, 0.10), v)
    gi = np.clip(np.round(v * (len(ramp) - 1)), 0, len(ramp) - 1).astype(np.uint8)

    keep = (M > 0.45)
    ys, xs = np.nonzero(keep)
    aspect = rows * CELL_ASPECT / cols
    px = (xs + 0.5) / cols - 0.5                       # [-0.5, 0.5] across the width
    py = -((ys + 0.5) / rows - 0.5) * aspect           # up = +y
    dz = D[ys, xs]
    pz = (dz - np.median(dz)) * 0.24                    # depth relief, in width units
    rng = np.random.default_rng(11)
    n = len(xs)
    pos = np.stack([px, py, pz], 1).astype(np.float16)
    u8 = np.stack([np.round(T[ys, xs] * 255), np.round(R[ys, xs] * 255), np.round(np.clip(F[ys, xs], 0, 1) * 255),
                   gi[ys, xs], rng.integers(0, 256, n)], 1).astype(np.uint8)
    rec = np.zeros(n, dtype=[("p", "<f2", 3), ("u", "u1", 5)])
    rec["p"], rec["u"] = pos, u8
    rec.tofile(OUT / "points.bin")
    meta = {"count": int(n), "cols": cols, "rows": rows, "aspect": float(aspect), "ramp": ramp,
            "stride": 11, "layout": "f16 x,y,z | u8 tone,rim,feat,glyph,rand"}
    (OUT / "points.json").write_text(json.dumps(meta, indent=1))

    # still render (warm mono + soft glow): review preview and the site's no-WebGL / reduced-motion fallback
    still = render_still(xs, ys, T[ys, xs], R[ys, xs], gi[ys, xs], ramp, cols, rows)
    still.save(OUT / "preview.png")
    if a.publish:
        pub = C.ROOT / "public" / "field"
        pub.mkdir(parents=True, exist_ok=True)
        small = still.resize((640, round(640 * still.height / still.width)), Image.LANCZOS)
        small.save(pub / "still.webp", "WEBP", quality=60, method=6)
        meta["still"] = list(small.size)
        (C.ROOT / "src" / "data" / "field-meta.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8", newline="\n")
        # terminal `whoami --face`: same glyph ramp, 92 columns
        tc = 92
        trows = int(H / (W / tc * 2.0))
        Tt = cv2.resize(tone.astype(np.float32), (tc, trows), interpolation=cv2.INTER_AREA)
        Mt = cv2.resize(soft, (tc, trows), interpolation=cv2.INTER_AREA)
        lines = []
        for y in range(trows):
            row = "".join(ramp[int(np.clip(round((0.08 + 0.92 * Tt[y, x]) * (len(ramp) - 1)), 0, len(ramp) - 1))] if Mt[y, x] > 0.45 else " " for x in range(tc))
            lines.append(row.rstrip())
        while lines and not lines[-1]:
            lines.pop()
        (C.ROOT / "src" / "data" / "portrait-ascii.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        print("published public/field/still.webp", still.size, "and src/data/field-meta.json")
    print(f"{n} points, grid {cols}x{rows}, ramp '{ramp}', bin {(OUT / 'points.bin').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
