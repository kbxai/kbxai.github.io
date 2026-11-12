// Live ASCII self-portrait: shader + pure helpers (unit-tested).
// The texture maps.png is produced by scripts/portrait/render.py:
//   R luminance, G = edgeDir*64 + edgeStrength*63 (0 = no edge), B depth, A person mask.

/** Fill ramp (dark -> bright) and edge glyphs (-, /, |, \). Must match render.py. */
export const FILL = ' .,:;=+*#%@';
export const EDGE = '-/|\\';
export const ATLAS = FILL + EDGE;

export function decodeEdge(g255: number): { dir: number; strength: number } {
  if (g255 <= 0) return { dir: 0, strength: 0 };
  const dir = Math.min(3, Math.floor(g255 / 64));
  return { dir, strength: (g255 - dir * 64) / 63 };
}

/** Boot "signal lock": 0 -> 1 over `duration` ms with an ease-out curve. */
export function bootProgress(elapsedMs: number, duration = 1200): number {
  const t = Math.min(1, Math.max(0, elapsedMs / duration));
  return 1 - Math.pow(1 - t, 3);
}

/** Cursor ripple strength at distance d (in cells), radius r. 1 at the centre, 0 outside. */
export function rippleFalloff(d: number, r = 9): number {
  if (d >= r) return 0;
  const x = d / r;
  return (1 - x * x) * (1 - x * x);
}

/** Parallax offset in UV units, clamped so the face never slides out of frame. */
export function parallax(pointer: number, depth: number, amount = 0.018): number {
  const p = Math.max(-1, Math.min(1, pointer));
  return p * depth * amount;
}

/**
 * Grid so the portrait texture maps to whole character cells (one texel per cell, centred, even margins).
 * Returns total grid size and the fraction of the canvas the portrait occupies.
 */
export function portraitGrid(w: number, h: number, texCols: number, texRows: number, cellAspect = 1.6) {
  const portraitAspect = texCols / (texRows * cellAspect); // width / height in px
  const fitW = w / h > portraitAspect ? (h * portraitAspect) / w : 1;
  const fitH = w / h > portraitAspect ? 1 : w / portraitAspect / h;
  let cols = Math.max(texCols, Math.round(texCols / fitW));
  let rows = Math.max(texRows, Math.round(texRows / fitH));
  if ((cols - texCols) % 2) cols += 1;
  if ((rows - texRows) % 2) rows += 1;
  return { cols, rows, fitX: texCols / cols, fitY: texRows / rows };
}

export const portraitVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const portraitFragment = /* glsl */ `
precision highp float;
uniform sampler2D tMaps;
uniform sampler2D tAtlas;
uniform vec2 uGrid;        // character cells (cols, rows)
uniform vec2 uFit;         // portrait UV scale to keep 4:5 aspect inside the canvas
uniform float uGlyphs;     // atlas glyph count
uniform float uFill;       // number of fill glyphs
uniform float uBoot;       // 0..1 signal lock
uniform float uDissolve;   // 0..1 scroll dissolve
uniform float uTime;
uniform vec2 uPointer;     // -1..1
uniform vec2 uMouseCell;   // pointer position in cells (or -999)
uniform float uRipple;     // ripple radius in cells
uniform vec3 uFillColor;
uniform vec3 uEdgeColor;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 cell = floor(vUv * uGrid);
  vec2 local = fract(vUv * uGrid);
  float h = hash(cell);
  float h2 = hash(cell + 17.0);

  // ripple around the cursor
  float d = length((cell - uMouseCell) * vec2(1.0, 1.6));
  float x = clamp(d / uRipple, 0.0, 1.0);
  float ripple = (1.0 - x * x) * (1.0 - x * x) * step(d, uRipple);

  // dissolve: cells drift and fade in random order while scrolling away
  vec2 drift = vec2((h - 0.5) * 6.0, h * 10.0) * uDissolve;
  vec2 src = (cell + 0.5 - drift) / uGrid;
  // fit portrait (4:5) into the canvas, centred
  vec2 puv = (src - 0.5) / uFit + 0.5;

  vec4 m0 = texture2D(tMaps, puv);
  // depth parallax: nearer parts shift more with the pointer
  puv += uPointer * m0.b * vec2(0.018, 0.012);
  vec4 m = texture2D(tMaps, puv);
  float inside = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
  float mask = m.a * inside;

  float g255 = floor(m.g * 255.0 + 0.5);
  float dir = floor(g255 / 64.0);
  float strength = (g255 - dir * 64.0) / 63.0;
  bool isEdge = g255 > 0.5 && strength > 0.35;

  float lum = m.r;
  float idx = isEdge ? (uFill + dir) : floor(clamp(lum, 0.0, 0.999) * uFill);

  // boot: random glyphs that lock in cell by cell; ripple re-scrambles near the cursor
  float scramble = max(step(uBoot, h2), ripple * step(0.5, fract(uTime * 7.0 + h * 13.0)));
  if (scramble > 0.5 && mask > 0.35) idx = floor(hash(cell + floor(uTime * 14.0)) * (uGlyphs - 1.0)) + 1.0;

  vec2 aUv = vec2((idx + local.x) / uGlyphs, local.y);
  float g = texture2D(tAtlas, aUv).r;

  float alive = (1.0 - smoothstep(h - 0.15, h + 0.15, uDissolve * 1.2)) * step(0.35, mask);
  float bright = isEdge ? 1.0 : (0.35 + 0.65 * (idx / max(uFill - 1.0, 1.0)));
  vec3 col = isEdge ? uEdgeColor : uFillColor;
  col = mix(col, uEdgeColor, ripple * 0.6);
  float flicker = 0.96 + 0.04 * sin(uTime * 2.0 + h * 6.2831);
  float a = g * bright * alive * flicker;
  gl_FragColor = vec4(col * a, a);
}
`;
