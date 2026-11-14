import { describe, expect, it } from 'vitest';
import { melBinEdges, toMelBands, glyphFor, hzToMel, melToHz } from '../../src/lib/mel';

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
