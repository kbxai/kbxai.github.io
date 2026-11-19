"""Capture public/field/still.webp from the live WebGL portrait at rest, so the still and the live render match
(no brightness or lighting jump when the canvas fades in, and phones that never start the canvas see the same face).

Needs a running build of the site:  npx astro preview --port 4330
Usage:  python scripts/portrait/capture_still.py [base_url]   (default http://127.0.0.1:4330)

The canvas lays the glyph grid out in the same box as the still (2% inset, contained; see resize() in
src/three/grid.ts), so this script recomputes that box, screenshots exactly it over the page background,
and resizes it to the still's size in src/data/field-meta.json.
"""
import io, json, sys
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4330"
META = json.loads((ROOT / "src/data/field-meta.json").read_text(encoding="utf-8"))
OUT = ROOT / "public/field/still.webp"
CELL_ASPECT = 1.6  # must match src/three/grid.ts

HIDE = """
  .top, .hero-copy, .hero-foot, #term-launch, .motion-toggle, .motion-pill, footer, .progress { visibility: hidden !important; }
  body::before, .art::after { display: none !important; }
  .portrait-still { opacity: 0 !important; }
"""

BOX_JS = """([cols, rows, aspect]) => {
  const c = document.querySelector('#hero-art canvas'); const r = c.getBoundingClientRect(); const dpr = c.width / r.width;
  const W = c.width, H = c.height;
  const fit = Math.min((W * 0.96) / cols, (H * 0.96) / (rows * aspect));
  const cw = Math.max(2, Math.floor(fit)), ch = Math.max(3, Math.round(cw * aspect));
  const ox = Math.round((W - cw * cols) / 2), oy = Math.round((H - ch * rows) / 2);
  return { x: r.left + ox / dpr, y: r.top + oy / dpr, width: (cw * cols) / dpr, height: (ch * rows) / dpr, cell: [cw, ch] };
}"""


def main() -> None:
    cols, rows = META["maps"]
    sw, sh = META["still"]
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--ignore-gpu-blocklist"])
        ctx = b.new_context(viewport={"width": 1920, "height": 1200}, device_scale_factor=2)
        ctx.add_init_script("try{sessionStorage.setItem('kb.field','1')}catch(e){}")  # no intro: start at rest
        pg = ctx.new_page()
        pg.goto(BASE + "/")
        pg.wait_for_selector("#hero-art.live", timeout=30000)
        for _ in range(3):  # let the light settle to its frontal rest state
            pg.evaluate("window.dispatchEvent(new Event('scroll'))")
            pg.wait_for_timeout(2000)
        pg.add_style_tag(content=HIDE)
        pg.wait_for_timeout(300)
        box = pg.evaluate(BOX_JS, [cols, rows, CELL_ASPECT])
        png = pg.screenshot(clip={k: box[k] for k in ("x", "y", "width", "height")})
        b.close()
    im = Image.open(io.BytesIO(png)).convert("RGB")
    print(f"captured {im.size} (cell {box['cell']} device px), writing {sw}x{sh}")
    im.resize((sw, sh), Image.LANCZOS).save(OUT, "WEBP", quality=72, method=6)
    print("wrote", OUT, OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
