// Generates static assets: favicon (KB monogram, our own geometry) and the OG image (ASCII self-portrait + name).
// The portrait text comes from scripts/portrait/render.py -> src/data/portrait-ascii.txt.
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
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}"><rect width="100%" height="100%" rx="1.2" fill="#0b0f0c"/><path d="${allD(pad, (W - H) / 2)}" fill="#7cff8a" fill-rule="evenodd"/></svg>`);

// 2. OG image 1200x630 with the ASCII portrait on the right
const EDGE = '-/|\\';
const face = (await readFile(new URL('../src/data/portrait-ascii.txt', import.meta.url), 'utf8')).split('\n').filter((l, i, a) => i < a.length - 1 || l);
const fs = 11.2, lh = 12.0, x0 = 610, y0 = 18;
const rows = face.map((line, i) => {
  // amber spans for edge glyphs, green for the rest
  let out = '', cur = '', curEdge = null;
  const flush = () => { if (cur) out += `<tspan fill="${curEdge ? '#ffb454' : '#7cff8a'}">${esc(cur)}</tspan>`; cur = ''; };
  for (const ch of line) {
    const e = EDGE.includes(ch);
    if (curEdge !== null && e !== curEdge) flush();
    curEdge = e;
    cur += ch;
  }
  flush();
  return `<text x="${x0}" y="${y0 + i * lh}" xml:space="preserve">${out}</text>`;
}).join('');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><filter id="g"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <rect width="1200" height="630" fill="#0b0f0c"/>
  <g font-family="DejaVu Sans Mono, Consolas, monospace" font-size="${fs}" font-weight="700" filter="url(#g)">${rows}</g>
  <g font-family="DejaVu Sans Mono, Consolas, monospace" fill="#c7f5c0">
    <text x="60" y="120" font-size="22" fill="#86a886">visitor@kbxai:~$ whoami</text>
    <text x="60" y="200" font-size="60" font-weight="700" fill="#7cff8a" filter="url(#g)">Kartik Bajaj</text>
    <text x="60" y="258" font-size="26">AI/LLM Engineer internship</text>
    <text x="60" y="304" font-size="21" fill="#86a886">IIT Madras BS Data Science</text>
    <text x="60" y="400" font-size="24" fill="#ffb454">Macro F1 0.954 | live LLM apps</text>
    <text x="60" y="560" font-size="21" fill="#86a886">kbxai.github.io</text>
  </g>
</svg>`;
await sharp(Buffer.from(og)).png({ compressionLevel: 9, palette: true }).toFile(toPath(new URL('../public/og.png', import.meta.url)));
console.log('[make-assets] wrote public/favicon.svg, public/og.png');
