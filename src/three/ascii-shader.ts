// Shared, testable pieces of the ASCII pass.

/** Glyph ramp from empty to dense. Must match scripts/make-assets.mjs. */
export const RAMP = ' .:-=+*#%@';

export function cellGrid(width: number, height: number, cellPx: number): { cols: number; rows: number } {
  const cols = Math.max(8, Math.min(220, Math.floor(width / cellPx)));
  // character cells are roughly 1:1.6 wide:tall in a monospace font
  const rows = Math.max(6, Math.min(140, Math.floor(height / (cellPx * 1.6))));
  return { cols, rows };
}

/** 0 at the top of the page, 1 once the hero has scrolled ~80% out of view. */
export function dissolveFromScroll(scrollY: number, heroBottom: number): number {
  if (heroBottom <= 0) return 0;
  const v = scrollY / (heroBottom * 0.8);
  return Math.min(1, Math.max(0, v));
}

export const asciiVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const asciiFragment = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tAtlas;
uniform vec2 uGrid;
uniform float uGlyphs;
uniform float uDissolve;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 cell = floor(vUv * uGrid);
  vec2 local = fract(vUv * uGrid);
  float h = hash(cell);

  // dissolve: cells drift upward and fade in a random order as the visitor scrolls
  vec2 drift = vec2((h - 0.5) * 6.0, h * 10.0) * uDissolve;
  vec2 src = (cell + 0.5 - drift) / uGrid;
  vec4 s = texture2D(tScene, src);
  float lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) * s.a;
  float alive = 1.0 - smoothstep(h - 0.15, h + 0.15, uDissolve * 1.2);

  float idx = floor(clamp(lum, 0.0, 0.999) * uGlyphs);
  vec2 aUv = vec2((idx + local.x) / uGlyphs, local.y);
  float g = texture2D(tAtlas, aUv).r;

  float flicker = 0.96 + 0.04 * sin(uTime * 2.0 + h * 6.2831);
  vec3 col = mix(uColor, uHot, smoothstep(0.82, 1.0, lum));
  float a = g * alive * flicker;
  gl_FragColor = vec4(col * a, a);
}
`;
