"""Capture the portrait preview: a final-frame contact sheet and one GIF per version.

Serves scripts/portrait/out/versions on localhost, drives it with Playwright (Chromium), grabs frames.
Run: python scripts/portrait/capture_preview.py   (outputs land in scripts/portrait/out/versions/, gitignored)
"""
from __future__ import annotations

import functools
import http.server
import io
import threading
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

VER = Path(__file__).parent / "out" / "versions"
STYLES = ["ink", "cel", "character", "relief"]
FPS, SECONDS, WIDTH = 15, 4.2, 460


def serve() -> http.server.ThreadingHTTPServer:
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(VER))
    h.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main() -> None:
    srv = serve()
    url = f"http://127.0.0.1:{srv.server_address[1]}/preview.html"
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1900, "height": 1000}, device_scale_factor=1)
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_function("document.querySelectorAll('canvas').length === 4")
        canvases = page.locator("canvas")
        # final frames (reduced-motion path)
        page.check("#still")
        page.wait_for_timeout(300)
        page.screenshot(path=str(VER / "preview-final.png"), full_page=True)
        page.uncheck("#still")
        # per-version GIFs of the intro, rendered on a virtual clock (frame-exact, independent of capture speed)
        frames = {s: [] for s in STYLES}
        n = int(FPS * SECONDS)
        for k in range(n):
            ms = k * 1000 / FPS
            # second half: a pointer sweep across the face to show the hover response
            if ms > 2600:
                f = (ms - 2600) / (SECONDS * 1000 - 2600)
                page.evaluate(f"renderAt({ms}, {80 + f * 900}, {420 - f * 120})")
            else:
                page.evaluate(f"renderAt({ms})")
            for i, s in enumerate(STYLES):
                png = canvases.nth(i).screenshot()
                im = Image.open(io.BytesIO(png)).convert("RGB")
                frames[s].append(im.resize((WIDTH, int(im.height * WIDTH / im.width))))
        b.close()
    srv.shutdown()
    for s, fr in frames.items():
        q = [f.quantize(colors=48, method=Image.Quantize.MEDIANCUT) for f in fr]
        q[0].save(VER / f"{s}.gif", save_all=True, append_images=q[1:], duration=int(1000 / FPS), loop=0, optimize=False)
        print(s, len(fr), "frames", (VER / f"{s}.gif").stat().st_size // 1024, "KB")
    print("console errors:", errors or "none")


if __name__ == "__main__":
    main()
