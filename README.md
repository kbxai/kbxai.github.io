# kbxai.github.io

Portfolio of **Kartik Bajaj** (IIT Madras BS Data Science), seeking an AI/LLM Engineer internship.
A glowing ASCII / terminal-style site: static, accessible content first, with a 3D ASCII hero and an interactive shell loaded after the page is usable.

## What is in it
- **Static pages** (Astro): home, one `man`-style page per project, resume, 404. All content works without JavaScript.
- **Interactive terminal**: `help`, `ls projects`, `cat <project>`, `open <x>`, `contact`, `motion`, `ask <question>`, `sudo hire kartik`.
- **ASCII portrait hero** (raw WebGL2, `src/three/grid.ts`): a real photo turned into shape-matched ASCII (each cell picks one of 95 characters by the shape of the light inside it, on the GPU). A cyan rim light, an in-place decode intro, a pointer-driven light, and a sprinkle-into-dust effect on scroll. Data from `scripts/portrait/` (depth.py, then shape_ascii.py, then capture_still.py for the still). Loaded after first paint; reduced motion, the pause toggle, no WebGL2 or Save-Data get the still.
- **3D project figures** (three.js, `src/three/works/`): one small scene per project row, drawn in the portrait's glyph material and driven by scroll.
- **Spectrogram lab**: live audio (synthesized track, your file, or microphone) drawn as a glowing log-mel glyph waterfall. Nothing leaves the browser.
- **ask**: questions go to a small FastAPI + Gemini service on Hugging Face ([ask-kartik-api](https://github.com/kbxai/ask-kartik-api)) that answers only from `public/knowledge.json`; if it is asleep, the terminal answers offline from the same facts.
- **Live HUD** in the footer: measured LCP, CLS, INP, JS transferred, 3D state and frame time.
- **Experimental** (desktop): `experimental fluid`, `experimental crt`.

## Facts are checked
`scripts/check-facts.mjs` fails the build if any number, title, date, bullet or link in `src/data` differs from `resume/resume.md`, or if stale facts reappear.

## Commands
```
npm ci
npm run dev          # http://localhost:4321
npm test             # unit tests (vitest)
npm run build        # fetch GitHub repos, check facts, build knowledge.json, build site
npx astro preview --port 4330 & E2E_BASE=http://127.0.0.1:4330 python tests/e2e/run_e2e.py
```

## Budgets
LCP at most 2.5 s, INP at most 200 ms, CLS at most 0.1; three.js chunk loaded after first paint (about 138 KB gzipped); contrast at least 4.5:1 without glow; `prefers-reduced-motion` and a pause button stop all animation.

## Credits
Fonts: Newsreader, Atkinson Hyperlegible Next, JetBrains Mono (SIL OFL 1.1). Built with AI coding tools (Claude Code, Google Antigravity); designed, reviewed and maintained by Kartik.
