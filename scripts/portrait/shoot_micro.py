"""Screenshot the micro-glyph portrait prototype at fixed moments (intro, rest, tilt + lens, scroll).

Run: python scripts/portrait/shoot_micro.py  -> scripts/portrait/out/micro/shots/*.png (gitignored)
"""
from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

DIR = Path(__file__).parent / "out" / "micro"
SHOTS = [
    ("1-intro-0.4s", dict(ms=400, mx=0, my=0)), ("2-intro-1.2s", dict(ms=1200, mx=0, my=0)), ("3-rest", dict(ms=4000, pal=0, mx=0, my=0)),
    ("4-rest-mono", dict(ms=4000, pal=1, mx=0, my=0)), ("5-tilt-lens", dict(ms=4000, mx=0.42, my=0.12, pal=0)),
    ("6-scroll-0.35", dict(ms=4000, scroll=0.35, pal=0, mx=0, my=0)), ("7-scroll-0.7", dict(ms=4000, scroll=0.7, pal=0, mx=0, my=0)),
]


def main() -> None:
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIR))
    h.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    (DIR / "shots").mkdir(exist_ok=True)
    errs: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        for vw, vh, tag in ((1440, 900, "desk"), (390, 844, "phone")):
            page = b.new_page(viewport={"width": vw, "height": vh}, device_scale_factor=1)
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(f"http://127.0.0.1:{srv.server_address[1]}/index.html")
            page.wait_for_function("window.kbReady === true", timeout=60000)
            for name, s in SHOTS if tag == "desk" else SHOTS[2:3]:
                if "pal" in s:
                    page.click(f"[data-pal='{s['pal']}']")
                page.evaluate(f"kbSet({{ms: {s['ms']}, scroll: {s.get('scroll', 0)}, mx: {s.get('mx', 'undefined')}, my: {s.get('my', 'undefined')}}})")
                page.wait_for_timeout(1500)
                page.screenshot(path=str(DIR / "shots" / f"{tag}-{name}.png"))
            page.close()
        b.close()
    srv.shutdown()
    print("errors:", errs or "none")


if __name__ == "__main__":
    main()
