import { describe, expect, it } from 'vitest';
import { ATLAS, EDGE, FILL, bootProgress, decodeEdge, parallax, rippleFalloff } from '../../src/three/portrait-shader';
import { readFileSync } from 'node:fs';
import { run } from '../../src/scripts/terminal/commands';
import profile from '../../src/data/profile.json';
import projects from '../../src/data/projects.json';

describe('portrait shader helpers', () => {
  it('atlas = fill ramp + 4 edge glyphs, matching the Python renderer', () => {
    expect(ATLAS).toBe(FILL + EDGE);
    const py = readFileSync('scripts/portrait/render.py', 'utf8');
    expect(py).toContain(`FILL = "${FILL}"`);
    expect(py).toContain('EDGE = "-/|\\\\"');
  });
  it('decodes packed edge direction and strength', () => {
    expect(decodeEdge(0)).toEqual({ dir: 0, strength: 0 });
    expect(decodeEdge(63)).toEqual({ dir: 0, strength: 1 });
    expect(decodeEdge(64 * 2 + 63)).toEqual({ dir: 2, strength: 1 });
    expect(decodeEdge(64 * 3 + 0).dir).toBe(3);
  });
  it('boot progress eases from 0 to 1 and clamps', () => {
    expect(bootProgress(-5)).toBe(0);
    expect(bootProgress(600)).toBeGreaterThan(0.8);
    expect(bootProgress(5000)).toBe(1);
  });
  it('ripple falls off to zero at the radius', () => {
    expect(rippleFalloff(0)).toBe(1);
    expect(rippleFalloff(4.5)).toBeGreaterThan(0);
    expect(rippleFalloff(9)).toBe(0);
  });
  it('parallax is clamped and scales with depth', () => {
    expect(parallax(5, 1)).toBeCloseTo(0.018);
    expect(parallax(-1, 0.5)).toBeCloseTo(-0.009);
    expect(parallax(1, 0)).toBe(0);
  });
});

describe('whoami --face', () => {
  it('returns a face action', () => {
    expect(run('whoami --face', { profile, projects, history: [] }).action).toEqual({ type: 'face' });
  });
  it('portrait text exists and is a real portrait', () => {
    const txt = readFileSync('src/data/portrait-ascii.txt', 'utf8');
    const lines = txt.split('\n');
    expect(lines.length).toBeGreaterThan(30);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(96);
    expect([...'-/|\\'].some((c) => txt.includes(c))).toBe(true);
  });
});

import { portraitGrid } from '../../src/three/portrait-shader';
describe('portrait grid', () => {
  it('maps texture cells to whole, centred grid cells', () => {
    for (const [w, h] of [[560, 600], [1200, 500], [360, 700]]) {
      const g = portraitGrid(w, h, 120, 77);
      expect((g.cols - 120) % 2).toBe(0);
      expect((g.rows - 77) % 2).toBe(0);
      expect(g.fitX).toBeLessThanOrEqual(1);
      expect(g.fitY).toBeLessThanOrEqual(1);
      expect(g.cols * g.fitX).toBeCloseTo(120);
    }
  });
});
