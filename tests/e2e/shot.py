import sys
from playwright.sync_api import sync_playwright
url, out, w = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1280
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": w, "height": 900})
    pg.goto(url, wait_until="load"); pg.wait_for_timeout(3000)
    pg.screenshot(path=out); b.close()
