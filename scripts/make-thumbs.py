"""Screenshots the live demos, then scripts/dither-thumbs.mjs turns them into dithered phosphor thumbnails.

Skips any demo that is asleep or not loading, so no misleading "sleeping" screenshots are published.
Run: python scripts/make-thumbs.py && node scripts/dither-thumbs.mjs
"""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "scripts" / ".thumbs-raw"
RAW.mkdir(exist_ok=True)
projects = json.loads((ROOT / "src" / "data" / "projects.json").read_text(encoding="utf-8"))
SLEEP_WORDS = ("sleeping", "restart this space", "building", "runtime error", "404")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 800})
    for proj in projects:
        url = proj["links"].get("demo")
        if not url:
            continue
        try:
            page.goto(url, wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(2500)
            text = page.inner_text("body").lower()[:4000]
            if any(w in text for w in SLEEP_WORDS):
                print(f"skip {proj['slug']}: demo looks asleep or broken")
                (RAW / f"{proj['slug']}.png").unlink(missing_ok=True)
                continue
            page.screenshot(path=str(RAW / f"{proj['slug']}.png"))
            print(f"ok   {proj['slug']}")
        except Exception as e:  # noqa: BLE001
            print(f"skip {proj['slug']}: {str(e)[:80]}")
    b.close()
