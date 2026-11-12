import { describe, expect, it } from 'vitest';
import { cellGrid, dissolveFromScroll, RAMP } from '../../src/three/ascii-shader';
import { melBinEdges, toMelBands, glyphFor, hzToMel, melToHz, RAMP as LAB_RAMP } from '../../src/lib/mel';

describe('ascii pass helpers', () => {
  it('grid is clamped and uses taller-than-wide cells', () => {
    expect(cellGrid(900, 400, 9)).toEqual({ cols: 100, rows: 27 });
    expect(cellGrid(10, 10, 9)).toEqual({ cols: 8, rows: 6 });
    expect(cellGrid(10000, 10000, 2).cols).toBe(220);
  });
  it('dissolve goes 0 -> 1 with scroll and is clamped', () => {
    expect(dissolveFromScroll(0, 600)).toBe(0);
    expect(dissolveFromScroll(240, 600)).toBeCloseTo(0.5);
    expect(dissolveFromScroll(5000, 600)).toBe(1);
    expect(dissolveFromScroll(100, 0)).toBe(0);
  });
  it('hero and lab share the same glyph ramp', () => {
    expect(RAMP).toBe(LAB_RAMP);
  });
});

describe('mel helpers', () => {
  it('mel conversion round-trips', () => {
    expect(melToHz(hzToMel(1000))).toBeCloseTo(1000, 6);
  });
  it('band edges are strictly increasing and in range', () => {
    const e = melBinEdges(48, 1024, 48000);
    expect(e).toHaveLength(49);
    for (let i = 1; i < e.length; i++) expect(e[i]!).toBeGreaterThan(e[i - 1]!);
    expect(e.at(-1)!).toBeLessThanOrEqual(1023);
  });
  it('band averaging and glyph mapping', () => {
    const freq = new Uint8Array(1024).fill(255);
    const bands = toMelBands(freq, melBinEdges(8, 1024, 48000));
    expect([...bands].every((v) => v === 1)).toBe(true);
    expect(glyphFor(0)).toBe(' ');
    expect(glyphFor(1)).toBe('@');
  });
});
