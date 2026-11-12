import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": int(sys.argv[2]), "height": 900})
    pg.goto(sys.argv[1], wait_until="load"); pg.wait_for_timeout(2500)
    pg.screenshot(path=sys.argv[3], full_page=True); b.close()
