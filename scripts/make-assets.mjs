// Generates static assets from our own geometry: hero ASCII fallback, favicon, OG image.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const mono = JSON.parse(await readFile(new URL('../src/three/monogram.json', import.meta.url), 'utf8'));
const H = mono.height;
const pathD = (cmds, ox = 0, oy = 0, s = 1) =>
  cmds.map(([c, ...n]) => {
    const pts = [];
    for (let i = 0; i < n.length; i += 2) pts.push(`${(n[i] * s + ox).toFixed(2)} ${((H - n[i + 1]) * s + oy).toFixed(2)}`);
    return c + pts.join(' ');
  }).join(' ');
const allD = (ox, oy, s) => mono.shapes.map((sh) => [sh.outer, ...sh.holes].map((p) => pathD(p, ox, oy, s)).join(' ')).join(' ');

// 1. ASCII fallback (same ramp as the shader, darkest to brightest)
const COLS = 72, ROWS = 26, RAMP = " .:-=+*#%@";
const pad = 0.6, W = 10 + pad * 2, Hh = H + pad * 2;
const svgMask = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * 4}" height="${ROWS * 8}" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">
  <rect width="100%" height="100%" fill="#000"/>
  <path d="${allD(pad, pad, 1)}" fill="#fff" fill-rule="evenodd"/></svg>`;
const { data, info } = await sharp(Buffer.from(svgMask)).resize(COLS, ROWS, { kernel: 'lanczos3', fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
let ascii = '';
for (let y = 0; y < ROWS; y++) {
  let line = '';
  for (let x = 0; x < COLS; x++) {
    const v = data[(y * info.width + x) * info.channels] / 255;
    // light from upper-left: brighten edges facing it
    const shade = v * (0.75 + 0.25 * (1 - (x / COLS + y / ROWS) / 2));
    line += RAMP[Math.min(RAMP.length - 1, Math.round(shade * (RAMP.length - 1)))];
  }
  ascii += line.replace(/\s+$/, '') + '\n';
}
await writeFile(new URL('../src/data/hero-ascii.txt', import.meta.url), ascii);

// 2. Favicon
const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}"><rect width="100%" height="100%" rx="1.2" fill="#0b0f0c"/><path d="${allD(pad, (W - H) / 2, 1)}" fill="#7cff8a" fill-rule="evenodd"/></svg>`;
await writeFile(new URL('../public/favicon.svg', import.meta.url), fav);

// 3. OG image 1200x630 (text uses generic monospace so no font file is embedded)
const lines = ascii.split('\n').map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><filter id="g"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <rect width="1200" height="630" fill="#0b0f0c"/>
  <g font-family="monospace" font-size="14" fill="#7cff8a" filter="url(#g)">
    ${lines.map((l, i) => `<text x="640" y="${70 + i * 15}" xml:space="preserve">${l}</text>`).join('')}
  </g>
  <g font-family="monospace" fill="#c7f5c0">
    <text x="60" y="110" font-size="22" fill="#86a886">visitor@kbxai:~$ whoami</text>
    <text x="60" y="190" font-size="64" font-weight="700" fill="#7cff8a" filter="url(#g)">Kartik Bajaj</text>
    <text x="60" y="250" font-size="28">AI/LLM Engineer internship</text>
    <text x="60" y="300" font-size="22" fill="#86a886">IIT Madras BS Data Science</text>
    <text x="60" y="400" font-size="26" fill="#ffb454">Macro F1 0.954 | live LLM apps</text>
    <text x="60" y="560" font-size="22" fill="#86a886">kbxai.github.io</text>
  </g>
  <rect width="1200" height="630" fill="url(#s)" opacity="0"/>
</svg>`;
await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(new URL('../public/og.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// 4. Hero fallback as an image (decorative; avoids tiny text on phones)
const HW = 570, HH = 26 * 15 + 30;
const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}">
  <defs><filter id="g"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <g font-family="Consolas, 'DejaVu Sans Mono', monospace" font-size="14" font-weight="700" fill="#7cff8a" filter="url(#g)">
    ${lines.map((l, i) => `<text x="0" y="${22 + i * 15}" xml:space="preserve">${l}</text>`).join('')}
  </g></svg>`;
await sharp(Buffer.from(hero)).webp({ quality: 82, alphaQuality: 90 }).toFile(new URL('../public/hero-ascii.webp', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log('[make-assets] wrote src/data/hero-ascii.txt, public/favicon.svg, public/og.png');
