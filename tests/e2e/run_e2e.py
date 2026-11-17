"""End-to-end checks against `astro preview` (run via webapp-testing's with_server.py).

Usage:
  python .claude/skills/webapp-testing/scripts/with_server.py --server "npx astro preview --port 4321" --port 4321 -- python tests/e2e/run_e2e.py
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:4321")
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)
PAGES = ["/", "/projects/messy-mashup/", "/resume/", "/lab/spectrogram/", "/does-not-exist"]
failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        failures.append(msg)


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])

        print("[1] layout at 360 / 768 / 1280, console errors, horizontal scroll")
        for w in (360, 768, 1280):
            ctx = browser.new_context(viewport={"width": w, "height": 900})
            page = ctx.new_page()
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            for path in PAGES:
                page.goto(BASE + path, wait_until="load")
                page.wait_for_timeout(1500 if path == "/" else 300)
                sw = page.evaluate("document.documentElement.scrollWidth")
                check(sw <= w + 1, f"{w}px {path}: no horizontal scroll (scrollWidth {sw})")
                if path == "/":
                    page.screenshot(path=str(OUT / f"home-{w}.png"), full_page=False)
            real = [e for e in errors if "ask-kartik" not in e and "404" not in e]
            check(not real, f"{w}px: no console errors {real[:3]}")
            ctx.close()

        print("[2] content and facts in static HTML")
        page = browser.new_page()
        page.goto(BASE + "/", wait_until="load")
        html = page.content()
        for must in ("Kartik Bajaj", "8.04", "0.954", "Interview Intelligence AI", "kartikbajaj.me@gmail.com"):
            check(must in html, f"home contains {must!r}")
        for banned in ("8.23", "SmartParkr", "Kaggle F1"):
            check(banned not in html, f"home does not contain {banned!r}")
        check(page.locator("h1").count() == 1, "exactly one h1 on home")

        print("[3] 3D hero starts after load and is lazy")
        page.wait_for_timeout(4500)
        live = page.evaluate("document.getElementById('hero-art').classList.contains('live')")
        hud = page.locator('[data-hud="gpu"]').inner_text()
        check(live or "static" in hud, f"hero is live or reports a static reason (hud: {hud})")
        page.screenshot(path=str(OUT / "home-hero.png"))
        scripts = page.evaluate("[...document.querySelectorAll('script[src]')].map(s => s.src)")
        check(not any("three" in s for s in scripts), "three.js is not in the initial HTML scripts")

        print("[4] terminal commands (site-wide dialog)")
        check(page.locator("#term-launch").is_visible(), "terminal launcher is visible")
        page.locator("body").click(position={"x": 5, "y": 5})
        page.keyboard.press("/")
        page.wait_for_timeout(300)
        check(page.evaluate("document.getElementById('term-dialog').open"), "'/' opens the terminal")
        check(page.evaluate("document.activeElement.id") == "term-input", "terminal input has focus when opened")
        page.fill("#term-input", "whoami")
        page.keyboard.press("Enter")
        check("8.04" in page.locator("#term-log").inner_text(), "whoami prints CGPA 8.04")
        page.fill("#term-input", "ask what is your cgpa")
        page.keyboard.press("Enter")
        page.wait_for_timeout(9500)
        check("8.04" in page.locator("#term-log").inner_text(), "ask answers from site facts (remote or offline)")
        page.fill("#term-input", "cat messy")
        page.keyboard.press("Enter")
        check("0.954" in page.locator("#term-log").inner_text(), "cat messy shows 0.954")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        check(not page.evaluate("document.getElementById('term-dialog').open"), "Escape closes the terminal")
        page.goto(BASE + "/projects/messy-mashup/", wait_until="load")
        page.click("#term-launch")
        page.wait_for_timeout(300)
        check(page.evaluate("document.getElementById('term-dialog').open"), "launcher opens the terminal on a project page")
        check("0.954" in page.locator("#term-log").inner_text(), "conversation carries over to another page")
        page.keyboard.press("Escape")
        page.close()

        print("[5] keyboard path")
        page = browser.new_page()
        page.goto(BASE + "/", wait_until="load")
        page.keyboard.press("Tab")
        first = page.evaluate("document.activeElement.textContent.trim()")
        check(first == "Skip to content", f"first Tab focuses skip link ({first!r})")
        seen = set()
        for _ in range(40):
            page.keyboard.press("Tab")
            seen.add(page.evaluate("document.activeElement.tagName + ':' + (document.activeElement.id || document.activeElement.textContent.trim().slice(0,30))"))
        check(any(s.startswith("BUTTON:term-launch") for s in seen), "terminal launcher reachable by Tab")
        check(len(seen) > 15, f"Tab moves through many elements ({len(seen)})")
        page.close()

        print("[6] reduced motion: static hero")
        ctx = browser.new_context(reduced_motion="reduce")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="load")
        page.wait_for_timeout(2500)
        check(page.locator("#hero-art canvas").count() == 0, "no canvas under reduced motion")
        check(page.locator("#hero-fallback").is_visible(), "static portrait still visible")
        ctx.close()

        print("[7] no JavaScript: everything readable")
        ctx = browser.new_context(java_script_enabled=False)
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="load")
        txt = page.inner_text("body")
        check("Messy Mashup" in txt and "0.954" in txt and "Contact" in txt, "content present without JS")
        check(page.locator("#term").is_hidden() and page.locator("#term-launch").is_hidden(), "terminal and launcher hidden without JS")
        ctx.close()
        browser.close()

        print("[8] WebGL disabled: fallback")
        b2 = p.chromium.launch(args=["--disable-webgl", "--disable-webgl2"])
        page = b2.new_page()
        page.goto(BASE + "/", wait_until="load")
        page.wait_for_timeout(2500)
        check(page.locator("#hero-art canvas").count() == 0, "no canvas without WebGL")
        check("static" in page.locator('[data-hud="gpu"]').inner_text(), "HUD reports static fallback")
        b2.close()

    print("[9] external links")
    data = json.loads(Path("src/data/projects.json").read_text(encoding="utf-8"))
    for proj in data:
        for kind, url in proj["links"].items():
            try:
                req = urllib.request.Request(url, method="GET", headers={"User-Agent": "kbxai-linkcheck"})
                code = urllib.request.urlopen(req, timeout=20).status
            except Exception as e:  # noqa: BLE001
                code = getattr(e, "code", str(e)[:60])
            ok = code == 200
            print(("  ok   " if ok else "  WARN ") + f"{kind} {url} -> {code}")


if __name__ == "__main__":
    run()
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)
