// Ordered (Bayer 4x4) dithering + green phosphor tint for project thumbnails. Writes public/thumbs/*.webp and src/data/thumbs.json.
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const RAW = new URL('./.thumbs-raw/', import.meta.url);
const OUT = new URL('../public/thumbs/', import.meta.url);
const toPath = (u) => decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, '$1');
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const W = 480, H = 300;
const ON = [124, 255, 138], OFF = [11, 15, 12];

await mkdir(OUT, { recursive: true });
const map = {};
let files = [];
try { files = (await readdir(RAW)).filter((f) => f.endsWith('.png')); } catch { /* none */ }
for (const f of files) {
  const slug = f.replace(/\.png$/, '');
  const { data } = await sharp(toPath(new URL(f, RAW))).resize(W, H, { fit: 'cover', position: 'top' }).greyscale().normalise().raw().toBuffer({ resolveWithObject: true });
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = data[y * W + x] / 255;
      const on = v > B4[(y % 4) * 4 + (x % 4)];
      const c = on ? ON : OFF;
      rgb.set(c, (y * W + x) * 3);
    }
  const file = `${slug}.webp`;
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).webp({ lossless: true }).toFile(toPath(new URL(file, OUT)));
  map[slug] = { src: `/thumbs/${file}`, width: W, height: H };
  console.log(`[dither] ${file}`);
}
await writeFile(new URL('../src/data/thumbs.json', import.meta.url), JSON.stringify(map, null, 2) + '\n');
console.log(`[dither] ${Object.keys(map).length} thumbnail(s)`);
