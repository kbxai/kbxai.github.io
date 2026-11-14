"""Visual tour of the built site for review: viewport shots down the home page and key pages.

Run with `astro preview` on :4321:  python tests/e2e/tour.py   -> tests/e2e/out/tour/*.png
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4321"
OUT = Path(__file__).parent / "out" / "tour"
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        for w, h, tag in ((1440, 900, "desk"), (390, 844, "phone")):
            page = b.new_page(viewport={"width": w, "height": h})
            page.on("console", lambda m: errors.append(f"{tag}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"{tag}: {e}"))
            page.goto(BASE + "/", wait_until="load")
            page.wait_for_timeout(5500)  # hero starts after load + idle, intro 2.4 s
            page.screenshot(path=str(OUT / f"{tag}-00-hero.png"))
            total = page.evaluate("document.documentElement.scrollHeight")
            y, i = 0, 1
            while y < total - h and i < 16:
                y += int(h * 0.9)
                page.evaluate(f"window.scrollTo(0, {y})")
                page.wait_for_timeout(900)
                page.screenshot(path=str(OUT / f"{tag}-{i:02d}.png"))
                i += 1
            for path in ("/projects/messy-mashup/", "/resume/", "/lab/spectrogram/", "/nope"):
                page.goto(BASE + path, wait_until="load")
                page.wait_for_timeout(900)
                page.screenshot(path=str(OUT / f"{tag}-page{path.replace('/', '_')}.png"))
            page.close()
        b.close()
    print("errors:", errors or "none")


if __name__ == "__main__":
    main()
