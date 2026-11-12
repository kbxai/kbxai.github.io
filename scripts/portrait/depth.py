"""Step 2: monocular depth for the primary photo with Depth Anything V2 Small (Apache-2.0).
Run WITHOUT the G:-drive pylib (uses the system torch/transformers); model cache goes to HF_HOME on G:.
  HF_HOME=G:/ml-tools/hf python scripts/portrait/depth.py ../image.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from transformers import pipeline

OUT = Path(__file__).parent / "out"
img = Image.open(sys.argv[1]).convert("RGB")
pipe = pipeline(task="depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
depth = pipe(img)["predicted_depth"]
d = depth.squeeze().cpu().numpy().astype(np.float32)
d = np.array(Image.fromarray(d).resize(img.size, Image.BICUBIC))
d = (d - d.min()) / (d.max() - d.min() + 1e-6)  # 1 = near
np.save(OUT / "primary-depth.npy", d)
Image.fromarray((d * 255).astype(np.uint8)).save(OUT / "primary-depth.png")
print("depth", d.shape, float(d.min()), float(d.max()))
