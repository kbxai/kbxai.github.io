"""Likeness check for the ASCII character versions.

Runs MediaPipe Face Mesh on each rendered ASCII portrait (lightly blurred so glyphs read as tone) and
measures how far the detected feature points land from Kartik's true landmarks, in character cells.
If Face Mesh can find his face in the ASCII alone, and the points land within about one cell, the
features are where his features are.

Writes scripts/portrait/out/versions/likeness.json and likeness.png (overlay, gitignored).
Run: PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/likeness.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

_m = types.ModuleType("matplotlib")
_m.pyplot = types.ModuleType("matplotlib.pyplot")
sys.modules.setdefault("matplotlib", _m)
sys.modules.setdefault("matplotlib.pyplot", _m.pyplot)

import cv2  # noqa: E402
import mediapipe as mp  # noqa: E402
import numpy as np  # noqa: E402

VER = Path(__file__).parent / "out" / "versions"
STYLES = ["ink", "cel", "character", "relief"]
CELL_W, CELL_H, PAD = 12, 20, 16
KEY = {"eye_r_out": 33, "eye_r_in": 133, "eye_l_in": 362, "eye_l_out": 263, "brow_r": 105, "brow_l": 334,
       "nose_tip": 1, "mouth_r": 61, "mouth_l": 291, "chin": 152, "iris_r": 468, "iris_l": 473}


def detect(img: np.ndarray, mesh) -> np.ndarray | None:
    h, w = img.shape[:2]
    for sigma, invert in ((3, False), (5, False), (3, True), (7, False), (5, True)):
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        g = cv2.GaussianBlur(g, (0, 0), sigma)
        g = cv2.normalize(g, None, 0, 255, cv2.NORM_MINMAX)
        if invert:
            g = 255 - g
        res = mesh.process(cv2.cvtColor(g, cv2.COLOR_GRAY2RGB))
        if res.multi_face_landmarks:
            lm = res.multi_face_landmarks[0].landmark
            return np.array([[p.x * w, p.y * h] for p in lm], np.float32)
    return None


def main() -> None:
    mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, refine_landmarks=True, max_num_faces=1, min_detection_confidence=0.3)
    report, tiles = {}, []
    for st in STYLES:
        img = cv2.imread(str(VER / st / "portrait.png"))
        truth = json.loads((VER / st / "keypoints.json").read_text())
        pts = detect(img, mesh)
        over = img.copy()
        for k, (cx, cy) in truth.items():
            cv2.circle(over, (int(PAD + cx * CELL_W), int(PAD + cy * CELL_H)), 6, (0, 255, 0), 2)
        if pts is None:
            report[st] = {"detected": False}
        else:
            errs = {}
            for k, i in KEY.items():
                px, py = pts[i]
                cx, cy = (px - PAD) / CELL_W, (py - PAD) / CELL_H
                tx, ty = truth[k]
                errs[k] = round(float(np.hypot(cx - tx, (cy - ty) * CELL_H / CELL_W)), 2)  # in cell widths
                cv2.circle(over, (int(px), int(py)), 5, (0, 0, 255), -1)
            report[st] = {"detected": True, "mean_err_cells": round(float(np.mean(list(errs.values()))), 2),
                          "max_err_cells": max(errs.values()), "per_point": errs}
        h = 700
        tiles.append(cv2.resize(over, (int(over.shape[1] * h / over.shape[0]), h)))
        print(st, report[st].get("mean_err_cells", "not detected"), report[st].get("max_err_cells", ""))
    cv2.imwrite(str(VER / "likeness.png"), np.hstack(tiles))
    (VER / "likeness.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
