import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeField, fitDistance, halfToFloat, introProgress, scrollProgress } from '../../src/three/field-core';
import meta from '../../src/data/field-meta.json';
import { run } from '../../src/scripts/terminal/commands';
import profile from '../../src/data/profile.json';
import projects from '../../src/data/projects.json';

const bin = readFileSync('public/field/points.bin');
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);

describe('half floats', () => {
  it('decodes common values', () => {
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
  });
});

describe('portrait field data', () => {
  it('file size matches the metadata', () => {
    expect(bin.byteLength).toBe(meta.count * meta.stride);
    expect(meta.count).toBeGreaterThan(4000);
    expect(meta.count).toBeLessThan(20000);
  });
  it('decodes into a centred portrait of width 1 with sane depth', () => {
    const f = decodeField(buf, meta);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
    for (let i = 0; i < meta.count; i++) {
      const x = f.positions[i * 3]!, y = f.positions[i * 3 + 1]!, z = f.positions[i * 3 + 2]!;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, Math.abs(z));
    }
    expect(minX).toBeGreaterThanOrEqual(-0.5);
    expect(maxX).toBeLessThanOrEqual(0.5);
    expect(maxY - minY).toBeLessThanOrEqual(meta.aspect + 0.01);
    expect(maxZ).toBeLessThan(0.35);
  });
  it('tone, rim and glyph indices are in range', () => {
    const f = decodeField(buf, meta);
    for (let i = 0; i < meta.count; i += 7) {
      for (let k = 0; k < 4; k++) {
        expect(f.data[i * 4 + k]!).toBeGreaterThanOrEqual(0);
        expect(f.data[i * 4 + k]!).toBeLessThanOrEqual(1);
      }
      expect(f.glyph[i]!).toBeLessThan(meta.ramp.length);
    }
  });
  it('rejects truncated data', () => {
    expect(() => decodeField(buf.slice(0, 100), meta)).toThrow();
  });
  it('glyph ramp fits the 4 x 4 atlas and has no spaces', () => {
    expect(meta.ramp.length).toBeLessThanOrEqual(16);
    expect(meta.ramp).not.toContain(' ');
  });
});

describe('field layout helpers', () => {
  it('fits the portrait inside wide and tall hosts', () => {
    const t = Math.tan((28 * Math.PI) / 360);
    for (const hostAspect of [0.5, 1, 2]) {
      const d = fitDistance(meta.aspect, hostAspect, 28);
      const visH = 2 * d * t;
      expect(visH).toBeGreaterThanOrEqual(meta.aspect);
      expect(visH * hostAspect).toBeGreaterThanOrEqual(1);
    }
  });
  it('scroll progress is 0 at rest, 1 when scrolled away, clamped', () => {
    expect(scrollProgress(0, 900)).toBe(0);
    expect(scrollProgress(100, 900)).toBe(0);
    expect(scrollProgress(-900 * 0.85, 900)).toBe(1);
    expect(scrollProgress(-5000, 900)).toBe(1);
    expect(scrollProgress(-100, 0)).toBe(0);
  });
  it('intro progress is linear and clamped', () => {
    expect(introProgress(-10)).toBe(0);
    expect(introProgress(1200)).toBeCloseTo(0.5);
    expect(introProgress(99999)).toBe(1);
  });
});

describe('whoami --face', () => {
  it('returns a face action', () => {
    expect(run('whoami --face', { profile, projects, history: [] }).action).toEqual({ type: 'face' });
  });
  it('portrait text exists and uses the field glyph ramp', () => {
    const txt = readFileSync('src/data/portrait-ascii.txt', 'utf8');
    const lines = txt.split('\n');
    expect(lines.length).toBeGreaterThan(30);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(96);
    const used = new Set(txt.replace(/[\s]/g, ''));
    for (const ch of used) expect(meta.ramp).toContain(ch);
  });
});
