import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scrollProgress } from '../../src/three/field-core';
import meta from '../../src/data/field-meta.json';
import { run } from '../../src/scripts/terminal/commands';
import profile from '../../src/data/profile.json';
import projects from '../../src/data/projects.json';

const maps = readFileSync('public/field/maps.webp');

describe('portrait maps (grid-locked hero)', () => {
  it('is a small WebP and the metadata names its grid', () => {
    expect(maps.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(maps.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(maps.byteLength).toBeLessThan(60 * 1024);
    expect(meta.maps).toEqual([meta.cols, meta.rows]);
  });
  it('glyph ramp has 16 or fewer glyphs and no spaces', () => {
    expect(meta.ramp.length).toBeLessThanOrEqual(16);
    expect(meta.ramp).not.toContain(' ');
  });
  it('scroll progress is 0 at rest, 1 when scrolled away, clamped', () => {
    expect(scrollProgress(0, 900)).toBe(0);
    expect(scrollProgress(100, 900)).toBe(0);
    expect(scrollProgress(-900 * 0.85, 900)).toBe(1);
    expect(scrollProgress(-5000, 900)).toBe(1);
    expect(scrollProgress(-100, 0)).toBe(0);
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
