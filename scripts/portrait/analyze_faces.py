"""Step 1 of the ASCII portrait pipeline: facial structure from ALL photos.

Runs MediaPipe Face Mesh (478 landmarks incl. irises) on every photo, estimates head pose,
aligns each face to a common frontal frame, and builds:
  - mean landmark shape (weighted by frontality)
  - median aligned face texture (cancels lighting quirks / colour casts)
  - person mask for the primary photo (Selfie Segmentation, covers hair)
Outputs go to scripts/portrait/out/ (gitignored). Photos are only read, never copied.

Run with the G:-drive libs:  PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/analyze_faces.py <photos...> --primary <photo>
"""
from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path

# matplotlib's DLL is blocked by Windows Application Control and mediapipe only needs it for drawing utils.
_m = types.ModuleType("matplotlib")
_m.pyplot = types.ModuleType("matplotlib.pyplot")
sys.modules.setdefault("matplotlib", _m)
sys.modules.setdefault("matplotlib.pyplot", _m.pyplot)

import cv2  # noqa: E402
import mediapipe as mp  # noqa: E402
import numpy as np  # noqa: E402

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

# Stable landmarks for alignment: outer/inner eye corners, nose bridge, nose tip, chin, mouth corners.
STABLE = [33, 133, 362, 263, 168, 1, 152, 61, 291]
CANVAS = 512  # aligned face canvas size


def pose_from_landmarks(pts: np.ndarray) -> dict[str, float]:
    """Approximate yaw/pitch/roll in degrees from 2D landmark geometry (no camera model needed)."""
    l_eye, r_eye = pts[33], pts[263]
    nose, chin, brow = pts[1], pts[152], pts[168]
    roll = float(np.degrees(np.arctan2(r_eye[1] - l_eye[1], r_eye[0] - l_eye[0])))
    mid_eye = (l_eye + r_eye) / 2
    eye_w = np.linalg.norm(r_eye - l_eye)
    yaw = float(np.degrees(np.arcsin(np.clip((nose[0] - mid_eye[0]) / (eye_w * 0.9), -1, 1))))
    face_h = np.linalg.norm(chin - brow)
    pitch = float(((nose[1] - brow[1]) / max(face_h, 1) - 0.42) * 180)
    return {"yaw": round(yaw, 1), "pitch": round(pitch, 1), "roll": round(roll, 1)}


def template() -> np.ndarray:
    """Target positions (in CANVAS px) for the STABLE landmarks of a frontal face."""
    c = CANVAS
    return np.array([
        [0.30, 0.40], [0.43, 0.40], [0.57, 0.40], [0.70, 0.40],  # eye corners
        [0.50, 0.40], [0.50, 0.58], [0.50, 0.86],               # bridge, tip, chin
        [0.39, 0.70], [0.61, 0.70],                             # mouth corners
    ], dtype=np.float32) * c


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("photos", nargs="+")
    ap.add_argument("--primary", required=True)
    args = ap.parse_args()

    mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, refine_landmarks=True, max_num_faces=1, min_detection_confidence=0.5)
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    tmpl = template()
    report, shapes, weights, crops = [], [], [], []

    for i, path in enumerate(args.photos):
        img = cv2.imread(path)
        if img is None:
            print(f"skip {path}: unreadable")
            continue
        h, w = img.shape[:2]
        res = mesh.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            print(f"skip {path}: no face")
            continue
        lm = res.multi_face_landmarks[0].landmark
        pts = np.array([[p.x * w, p.y * h] for p in lm], dtype=np.float32)
        pose = pose_from_landmarks(pts)
        frontality = float(np.exp(-((pose["yaw"] / 18) ** 2 + (pose["pitch"] / 25) ** 2 + (pose["roll"] / 20) ** 2)))
        M, _ = cv2.estimateAffinePartial2D(pts[STABLE], tmpl, method=cv2.LMEDS)
        aligned_pts = cv2.transform(pts[None], M)[0]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        aligned = cv2.warpAffine(gray, M, (CANVAS, CANVAS), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        # per-photo tone normalisation so the median is not dominated by exposure/colour cast
        aligned = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(aligned)
        shapes.append(aligned_pts)
        weights.append(frontality)
        crops.append(aligned)
        tag = f"face{i}"
        cv2.imwrite(str(OUT / f"{tag}-aligned.png"), aligned)
        report.append({"photo": Path(path).name, "tag": tag, "pose_deg": pose, "frontality": round(frontality, 3), "size": [w, h]})
        print(f"{Path(path).name:22s} yaw {pose['yaw']:6.1f} pitch {pose['pitch']:6.1f} roll {pose['roll']:6.1f} frontality {frontality:.2f}")

        if Path(path).resolve() == Path(args.primary).resolve():
            mask = seg.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).segmentation_mask
            np.savez_compressed(OUT / "primary.npz", landmarks=pts, mask=mask.astype(np.float32), M=M)
            cv2.imwrite(str(OUT / "primary-mask.png"), (mask * 255).astype(np.uint8))

    if not shapes:
        sys.exit("no faces found")
    wts = np.array(weights) / np.sum(weights)
    mean_shape = np.tensordot(wts, np.stack(shapes), axes=1)
    median_tex = np.median(np.stack(crops), axis=0).astype(np.uint8)
    cv2.imwrite(str(OUT / "median-face.png"), median_tex)
    np.savez_compressed(OUT / "structure.npz", mean_shape=mean_shape, weights=wts)

    # overlay mean shape on the median texture for inspection
    dbg = cv2.cvtColor(median_tex, cv2.COLOR_GRAY2BGR)
    for x, y in mean_shape.astype(int):
        cv2.circle(dbg, (int(x), int(y)), 1, (0, 255, 120), -1)
    cv2.imwrite(str(OUT / "mean-shape-overlay.png"), dbg)
    (OUT / "analysis.json").write_text(json.dumps(report, indent=2))
    print(f"\nbuilt mean shape from {len(shapes)} faces; weights {np.round(wts, 2).tolist()}")


if __name__ == "__main__":
    main()
