"""Hero photo: Kartik cut out of the original photo and placed on the page's ink.

The original stays outside the repo (G:/internship/photo-profile.png, read only); only the processed cut-out
is written to public/field/. Steps:
  1. person mask: MediaPipe selfie segmentation (model bundled with the package), refined at the hair edge
     with a guided filter on the photo, so strands keep a soft edge instead of a cut line
  2. grade: remove the yellow-green cast of the room light, a little lift in the shadows, neutral skin
  3. compose on #050606; the black T-shirt fades into the page towards the bottom
Outputs: public/field/photo-{720,1200}.webp (+ a debug sheet in scripts/portrait/out/photo/)

Run: PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/photo_cutout.py --src ../photo-profile.png [--publish]
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
OUT = HERE / "out" / "photo"
INK = np.array([6, 6, 5], np.float32)  # #050606 as BGR


def guided(I: np.ndarray, p: np.ndarray, r: int, eps: float) -> np.ndarray:
    """He et al. guided filter (grey guide), used to snap the mask edge to the photo's own edges."""
    box = lambda x: cv2.boxFilter(x, -1, (r, r))
    mI, mp_ = box(I), box(p)
    a = (box(I * p) - mI * mp_) / (box(I * I) - mI * mI + eps)
    b = mp_ - a * mI
    return box(a) * I + box(b)


def mask_of(bgr: np.ndarray) -> np.ndarray:
    H, W = bgr.shape[:2]
    with mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0) as seg:
        m = seg.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).segmentation_mask.astype(np.float32)
    hard = (m > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(hard, 8)
    if n > 1:
        hard = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    a = guided(g, hard.astype(np.float32), max(5, W // 90), 1e-3)
    return np.clip(a, 0, 1)


def grade(bgr: np.ndarray, a: np.ndarray) -> np.ndarray:
    x = bgr.astype(np.float32) / 255
    # white balance from the person's mid tones (grey-world on skin and shirt), pulled only part of the way
    sel = (a > 0.9) & (x.mean(2) > 0.12)
    mean = x[sel].mean(0)
    gain = (mean.mean() / mean) ** 0.6
    x = x * gain
    # tone: gentle lift of the shadows and a soft shoulder, so the face reads on the dark page
    lum = x.mean(2, keepdims=True)
    x = x * (1 + 0.35 * np.exp(-lum / 0.18)) * 1.08
    x = x / (1 + 0.12 * x)
    return np.clip(x, 0, 1) * 255


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    rgba = np.asarray(Image.open(a.src).convert("RGB"))
    bgr = cv2.cvtColor(rgba, cv2.COLOR_RGB2BGR)
    H, W = bgr.shape[:2]
    alpha = mask_of(bgr)
    col = grade(bgr, alpha)
    # the green curtain spills into the soft hair edge: take the colour out where the mask is partial
    spill = np.clip((0.97 - alpha) / 0.5, 0, 1)[..., None]
    col = col * (1 - spill) + col.mean(2, keepdims=True) * 0.8 * spill
    # the black T-shirt melts into the page: fade the alpha over the lowest 22% of the frame
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    alpha = alpha * np.clip((1.0 - yy) / 0.22, 0, 1) ** 0.8
    out = INK + (col - INK) * alpha[..., None]
    out = np.clip(out, 0, 255).astype(np.uint8)
    cv2.imwrite(str(OUT / "composite.png"), out)
    cv2.imwrite(str(OUT / "alpha.png"), (alpha * 255).astype(np.uint8))
    img = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
    for w in (720, 1200):
        im = img.resize((w, round(H * w / W)), Image.LANCZOS) if w <= W else img.resize((w, round(H * w / W)), Image.BICUBIC)
        im.save(OUT / f"photo-{w}.webp", "WEBP", quality=80, method=6)
        if a.publish:
            im.save(ROOT / "public" / "field" / f"photo-{w}.webp", "WEBP", quality=80, method=6)
    print("size", W, H, "published" if a.publish else "preview only")


if __name__ == "__main__":
    main()
