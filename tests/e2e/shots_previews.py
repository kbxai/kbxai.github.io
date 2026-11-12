from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    for name in ("a", "b", "c"):
        for w, h in ((1280, 820), (390, 844)):
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(f"http://localhost:4321/preview/{name}/", wait_until="load")
            pg.wait_for_timeout(4000)
            pg.screenshot(path=f"tests/e2e/out/preview-{name}-{w}.png")
            sw = pg.evaluate("document.documentElement.scrollWidth")
            print(name, w, "scrollWidth", sw, "errors", errs[:2], "live", pg.evaluate("!!document.querySelector('#hero-art.live')"))
            ctx.close()
    b.close()
