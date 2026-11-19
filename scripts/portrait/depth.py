"""Step 1 of the hero portrait: monocular depth of the source photo with Depth Anything V2 Small (Apache-2.0).
The normals that let the pointer move the light come from this map (scripts/portrait/shape_ascii.py reads it).
Run with the system torch/transformers; the model cache stays on G::
  HF_HOME=G:/ml-tools/hf python scripts/portrait/depth.py ../photo-profile.png
Then:  PYTHONPATH=G:/ml-tools/pylib python scripts/portrait/shape_ascii.py --src ../photo-profile.png --cols 120 --publish
And recapture the still from a preview build:  python scripts/portrait/capture_still.py
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from transformers import pipeline

OUT = Path(__file__).parent / "out" / "photo"
OUT.mkdir(parents=True, exist_ok=True)
img = Image.open(sys.argv[1]).convert("RGB")
pipe = pipeline(task="depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
d = pipe(img)["predicted_depth"].squeeze().cpu().numpy().astype(np.float32)
d = np.array(Image.fromarray(d).resize(img.size, Image.BICUBIC))
d = (d - d.min()) / (d.max() - d.min() + 1e-6)  # 1 = near
np.save(OUT / "depth.npy", d)
print("depth", d.shape)
