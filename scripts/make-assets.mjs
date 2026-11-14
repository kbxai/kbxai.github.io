// Generates static assets: favicon (KB monogram, our own geometry) and the OG image (portrait still + name).
// The still comes from scripts/portrait/micro.py --publish -> public/field/still.webp.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const toPath = (u) => decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, '$1');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 1. Favicon from the KB monogram outline
const mono = JSON.parse(await readFile(new URL('../src/three/monogram.json', import.meta.url), 'utf8'));
const H = mono.height;
const pad = 0.6, W = 10 + pad * 2;
const pathD = (cmds, ox, oy) =>
  cmds.map(([c, ...n]) => {
    const pts = [];
    for (let i = 0; i < n.length; i += 2) pts.push(`${(n[i] + ox).toFixed(2)} ${(H - n[i + 1] + oy).toFixed(2)}`);
    return c + pts.join(' ');
  }).join(' ');
const allD = (ox, oy) => mono.shapes.map((sh) => [sh.outer, ...sh.holes].map((p) => pathD(p, ox, oy)).join(' ')).join(' ');
await writeFile(new URL('../public/favicon.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}"><rect width="100%" height="100%" rx="1.2" fill="#0b0a12"/><path d="${allD(pad, (W - H) / 2)}" fill="#f6a347" fill-rule="evenodd"/></svg>`);

// 2. OG image 1200x630: the portrait still on the right, name and proof on the left (new palette)
const still = await sharp(toPath(new URL('../public/field/still.webp', import.meta.url))).resize({ height: 630 }).toBuffer();
const text = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="f" x1="0" x2="1"><stop offset="0.42" stop-color="#0b0a12"/><stop offset="0.62" stop-color="#0b0a12" stop-opacity="0"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#f)"/>
  <g font-family="Georgia, 'Times New Roman', serif" fill="#efe9df">
    <text x="64" y="250" font-size="104" letter-spacing="-3">Kartik</text>
    <text x="124" y="352" font-size="104" font-style="italic" letter-spacing="-3">Bajaj</text>
  </g>
  <g font-family="Segoe UI, Helvetica, Arial, sans-serif">
    <text x="66" y="430" font-size="27" fill="#a8a2b0">AI/LLM Engineer internship, IIT Madras</text>
    <text x="66" y="474" font-size="27" fill="#f6a347">Macro F1 0.954 and three live LLM and ML demos</text>
    <text x="66" y="566" font-size="22" fill="#8a8494">kbxai.github.io</text>
  </g>
</svg>`;
await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#0b0a12' } })
  .composite([{ input: still, left: 1200 - 520, top: 0 }, { input: Buffer.from(text), left: 0, top: 0 }])
  .png({ compressionLevel: 9 })
  .toFile(toPath(new URL('../public/og.png', import.meta.url)));
console.log('[make-assets] wrote public/favicon.svg, public/og.png');
