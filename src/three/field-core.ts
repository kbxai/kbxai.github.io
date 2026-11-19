// Pure helper for the hero portrait (no three.js, no DOM): unit-tested in tests/unit/field.test.ts.

/** 0 while the hero fills the screen, 1 once it has scrolled about 85% of its height away. */
export function scrollProgress(heroTop: number, heroHeight: number): number {
  if (heroHeight <= 0) return 0;
  return Math.min(1, Math.max(0, -heroTop / (heroHeight * 0.85)));
}
