"""Maps for the grid-locked hero portrait (src/three/grid.ts).

One texel per glyph cell, same grid and tone as the still (micro.py), so the live view at rest matches it:
Rows 0..rows-1 hold R tone (1..255 inside the silhouette, 0 outside), G normal x, B normal y (image coords,
y down, 128 = flat).
Rows rows..2*rows-1 hold the rim light in R, a bloom source in G and a backlight halo in B. No alpha channel: encoders and browsers may drop colour under
transparent pixels. Written as lossless WebP to public/field/maps.webp.

Run: PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/relight.py --primary ../image.png [--publish]
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
from micro import CELL_ASPECT, studio_maps  # noqa: E402
from PIL import Image  # noqa: E402

OUT = Path(__file__).parent / "out" / "relight"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--primary", required=True)
    ap.add_argument("--cols", type=int, default=140)
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()
    B = C.build_base(Path(a.primary))
    H, W = B["H"], B["W"]
    tone, soft, rim = studio_maps(B)
    cols = a.cols
    rows = int(H / (W / cols * CELL_ASPECT))
    rs = lambda arr: cv2.resize(arr.astype(np.float32), (cols, rows), interpolation=cv2.INTER_AREA)
    # average tone over the person only, so cells on the silhouette edge do not pick up the light wall
    person = B["person"].astype(np.float32)
    T = rs(tone * person) / np.maximum(rs(person), 1e-3)
    M, R = rs(soft), rs(rim)
    # smoother normals than the per-pixel ones: the light should roll over the face, not pick out pores
    n = B["normal"]
    nx = rs(cv2.GaussianBlur(n[..., 0], (0, 0), W * 0.012))
    ny = rs(cv2.GaussianBlur(n[..., 1], (0, 0), W * 0.012))
    inside = M > 0.45
    r = np.where(inside, np.clip(np.round(T * 254) + 1, 1, 255), 0)
    g = np.clip(np.round(nx * 127.5 + 127.5), 0, 255)
    b = np.clip(np.round(ny * 127.5 + 127.5), 0, 255)
    al = np.clip(np.round(R * 255), 0, 255)
    # glow sources (sampled with bilinear filtering in the shader):
    #   bloom: soft light from bright skin, about 2.5 cells wide
    #   halo:  a warm backlight just outside the silhouette, fading out towards the bottom of the frame
    lum = np.where(inside, np.clip((T - 0.35) / 0.65, 0, 1), 0).astype(np.float32)
    bloom = cv2.GaussianBlur(lum, (0, 0), 2.5)
    bloom /= max(1e-6, float(bloom.max()))
    mk = inside.astype(np.float32)
    halo = cv2.GaussianBlur(mk, (0, 0), 6.0) * (1 - cv2.GaussianBlur(mk, (0, 0), 1.2))
    yy = np.linspace(0, 1, rows, dtype=np.float32)[:, None]
    halo *= np.clip((0.92 - yy) / 0.35, 0, 1)
    halo /= max(1e-6, float(halo.max()))
    top = np.dstack([r, g, b])
    bottom = np.dstack([al, np.round(bloom * 255), np.round(halo * 255)])
    rgb = np.concatenate([top, bottom], 0).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(rgb, "RGB")
    img.save(OUT / "maps.webp", "WEBP", lossless=True, quality=100, method=6)
    # debug views
    Image.fromarray(np.dstack([g, b, np.full_like(g, 255)]).astype(np.uint8)).resize((cols * 4, rows * 4), Image.NEAREST).save(OUT / "normals.png")
    print(f"grid {cols}x{rows}, maps.webp {(OUT / 'maps.webp').stat().st_size // 1024} KB, inside {int(inside.sum())}")
    if a.publish:
        pub = C.ROOT / "public" / "field"
        img.save(pub / "maps.webp", "WEBP", lossless=True, quality=100, method=6)
        meta_p = C.ROOT / "src" / "data" / "field-meta.json"
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        meta["maps"] = [cols, rows]
        meta_p.write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8", newline="\n")
        print("published public/field/maps.webp")


if __name__ == "__main__":
    main()
