// Pure helpers for the portrait field (no three.js, no DOM): unit-tested in tests/unit/field.test.ts.

export interface FieldMeta {
  count: number; cols: number; rows: number; aspect: number; ramp: string; stride: number;
}

export interface FieldData {
  positions: Float32Array; // x, y, z per point (portrait width = 1, centred)
  data: Float32Array;      // tone, rim, feature, random per point (0..1)
  glyph: Float32Array;     // index into the measured glyph ramp
}

/** IEEE 754 half float -> number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Decode points.bin written by scripts/portrait/micro.py: f16 x,y,z then u8 tone,rim,feat,glyph,rand. */
export function decodeField(buf: ArrayBuffer, meta: FieldMeta): FieldData {
  const n = meta.count;
  if (buf.byteLength < n * meta.stride) throw new Error(`field data too short: ${buf.byteLength} < ${n * meta.stride}`);
  const dv = new DataView(buf);
  const positions = new Float32Array(n * 3);
  const data = new Float32Array(n * 4);
  const glyph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * meta.stride;
    positions[i * 3] = halfToFloat(dv.getUint16(o, true));
    positions[i * 3 + 1] = halfToFloat(dv.getUint16(o + 2, true));
    positions[i * 3 + 2] = halfToFloat(dv.getUint16(o + 4, true));
    data[i * 4] = dv.getUint8(o + 6) / 255;
    data[i * 4 + 1] = dv.getUint8(o + 7) / 255;
    data[i * 4 + 2] = dv.getUint8(o + 8) / 255;
    glyph[i] = Math.min(dv.getUint8(o + 9), meta.ramp.length - 1);
    data[i * 4 + 3] = dv.getUint8(o + 10) / 255;
  }
  return { positions, data, glyph };
}

/** Camera distance so a portrait of width 1 and height `aspect` fits the host with a margin. */
export function fitDistance(aspect: number, hostAspect: number, fovDeg: number, margin = 1.04): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const needH = Math.max(aspect, 1 / Math.max(hostAspect, 1e-3)) * margin;
  return needH / (2 * t);
}

/** 0 while the hero fills the screen, 1 once it has scrolled about 85% of its height away. */
export function scrollProgress(heroTop: number, heroHeight: number): number {
  if (heroHeight <= 0) return 0;
  return Math.min(1, Math.max(0, -heroTop / (heroHeight * 0.85)));
}

/** Intro progress 0..1 over `ms` with no easing (easing happens per point in the shader). */
export function introProgress(elapsed: number, ms = 2400): number {
  return Math.min(1, Math.max(0, elapsed / ms));
}
