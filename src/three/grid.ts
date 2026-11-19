// Hero portrait, shape-matched ASCII on a fixed grid: every character sits in its cell and never moves.
// Data (public/field/maps.webp, made by scripts/portrait/shape_ascii.py): per cell, six samples of where the
// light falls inside the cell, plus mean lightness and a surface normal. Each frame, pass 1 (one fragment per
// cell) relights the samples and picks the printable character whose ink has the closest shape (95 glyphs,
// JetBrains Mono 700); pass 2 draws that character crisp, with no glow and no backing, on the page.
// Intro: characters decode in place from noise, from the face outwards. Pointer: the light follows the cursor
// and the characters re-choose themselves; under the cursor they cycle in the accent. Rim: a cyan light from
// behind catches the back edge of the head (on the characters, not as a haze behind them). Scroll:
// sprinkle: characters dissolve into dust at random, dust settles around the silhouette, a soft cyan glow
// grows, and the portrait lingers while the text scrolls over it. At rest the light faces the camera, so the frame matches the still exactly.
import meta from '../data/field-meta.json';
import { scrollProgress } from './field-core';

interface Options { tier: 'high' | 'low'; onStats?: (frameMs: number, state?: string) => void }

const CELL_ASPECT = 1.6;
const INTRO_MS = 1500;
const CHARS = meta.chars;
const NG = CHARS.length;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// pass 1: one fragment per cell -> R = glyph index / 255, G = brightness, B = accent amount
// (cursor lens, dust), A = cyan rim light on the back edge of the head
const PICK = `#version 300 es
precision highp float;
uniform sampler2D uMaps, uGlyphs;
uniform vec2 uGrid, uMouse;      // uMouse in cells
uniform vec3 uLight;
uniform float uLit, uDis, uFade, uTime, uIntro, uLensR;
out vec4 o;
const int DUST[5] = int[5](14, 12, 7, 64, 26);   // dot, comma, quote, backquote, colon (indices into the printable characters)
// integer hash: well mixed, so random choices show no row or column pattern
float hashi(ivec2 c, int salt) {
  uint n = uint(c.x + 4096) * 1597334677u ^ uint(c.y + 4096) * 3812015801u ^ uint(salt) * 2654435761u;
  n = (n ^ (n >> 15)) * 2246822519u;
  n = (n ^ (n >> 13)) * 3266489917u;
  return float((n ^ (n >> 16)) >> 8) / 16777216.0;
}
float hash(vec2 c) { return hashi(ivec2(floor(c)), 0); }
float occ(ivec2 q) {
  if (q.x < 0 || q.y < 0 || q.x >= int(uGrid.x) || q.y >= int(uGrid.y)) return 0.0;
  vec3 a = texelFetch(uMaps, q, 0).rgb, b = texelFetch(uMaps, q + ivec2(0, int(uGrid.y)), 0).rgb;
  return step(0.004, max(max(a.r, a.g), max(max(a.b, b.r), max(b.g, b.b))));
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);            // cell x, cell y (top row = 0)
  int R = int(uGrid.y);
  vec3 a = texelFetch(uMaps, c, 0).rgb;
  vec3 b = texelFetch(uMaps, c + ivec2(0, R), 0).rgb;
  vec3 m = texelFetch(uMaps, c + ivec2(0, 2 * R), 0).rgb;
  vec2 cf = vec2(c);
  float h = hash(cf);
  // scroll: sprinkle. Every value below changes only with scroll, so the dust shimmers as you move.
  int step24 = int(floor(uDis * 28.0));
  if (max(max(a.r, a.g), max(max(a.b, b.r), max(b.g, b.b))) < 0.004) {
    // empty cell: dust settles around the silhouette, densest next to it
    if (uDis <= 0.0 || uIntro < 1.0) { o = vec4(0.0); return; }
    float near = 0.0;
    // a wider, sparser look-around (every other cell out to 6 across, 4 down), so the dust drifts further out
    for (int j = -4; j <= 4; j += 2) for (int i = -6; i <= 6; i += 2) near += occ(c + ivec2(i, j));
    near /= 35.0;
    float p = smoothstep(0.0, 0.5, uDis) * (1.0 - uFade) * near * 0.8;
    float r = hashi(c, 11 + step24);
    if (near < 0.02 || r > p) { o = vec4(0.0); return; }
    int dust = DUST[int(hashi(c, 101 + step24) * 4.99)];
    o = vec4(float(dust) / 255.0, 0.4 + 0.45 * hashi(c, 201 + step24), 0.35, 0.0);
    return;
  }

  // relight: compare the light now with the resting front light, through the cell's normal
  vec2 nxy = m.gb * 2.0 - 1.0;
  vec3 n = normalize(vec3(nxy, 1.0));
  float base = 0.4 + 0.6 * n.z;
  float now = 0.4 + 0.6 * max(dot(n, uLight), 0.0);
  float f = clamp(mix(1.0, now / base, uLit), 0.55, 1.6);
  // leaving the hero: everything fades out at the end
  float e = uFade;
  float v[6] = float[6](a.r, a.g, a.b, b.r, b.g, b.b);
  // a little per-cell jitter, so flat areas pick varied characters instead of one repeated column pattern
  for (int i = 0; i < 6; i++) {
    float j = (hashi(c, 500 + i) - 0.5) * 0.07;
    v[i] = clamp(pow(v[i], 1.0 / max(f, 0.05)) + j * step(0.02, v[i]), 0.0, 1.0);
  }

  // nearest glyph by shape (squared distance over the six circles)
  int best = 0; float bd = 1e9;
  for (int g = 0; g < ${NG}; g++) {
    vec3 g0 = texelFetch(uGlyphs, ivec2(g, 0), 0).rgb;
    vec3 g1 = texelFetch(uGlyphs, ivec2(g, 1), 0).rgb;
    vec3 d0 = vec3(v[0], v[1], v[2]) - g0, d1 = vec3(v[3], v[4], v[5]) - g1;
    float d = dot(d0, d0) + dot(d1, d1);
    if (d < bd) { bd = d; best = g; }
  }
  float lum = clamp(m.r * f, 0.0, 1.0);

  // rim light: a cyan light behind him, up and to the right, catches the cells on that edge of the silhouette
  float rim = 0.0, wsum = 0.0;
  vec2 L2 = normalize(vec2(1.0, -0.55));
  for (int j = -2; j <= 2; j++) for (int i = -3; i <= 3; i++) {
    if (i == 0 && j == 0) continue;
    vec2 d = vec2(float(i), float(j) * ${CELL_ASPECT});
    float w = max(0.0, dot(normalize(d), L2)) / length(d);
    rim += (1.0 - occ(c + ivec2(i, j))) * w;
    wsum += w;
  }
  // only the back of the head faces that light, and only cells with real tone (not the faint shoulder strokes)
  rim = smoothstep(0.2, 0.62, rim / wsum) * smoothstep(0.42, 0.62, cf.x / uGrid.x)
      * smoothstep(0.9, 0.72, cf.y / uGrid.y) * smoothstep(0.08, 0.22, m.r);

  // scroll: cells dissolve into dust at random (the darker ones first); the rest dim to a soft ghost
  float gone = 0.0;
  if (uDis > 0.0) {
    // at most about 70% of the cells turn to dust; the rest stay as a dim ghost of the face
    float t = hashi(c, 7) * 0.85 + lum * 0.15;
    gone = step(t, uDis * 0.78 - 0.04);
    if (gone > 0.5) {
      if (hashi(c, 301 + step24) > 0.5 * (1.0 - uFade)) { o = vec4(0.0); return; }
      best = DUST[int(hashi(c, 401 + step24) * 4.99)];
    }
    lum *= 1.0 - 0.45 * uDis;
  }
  // intro: each cell shows changing noise until its moment, nearest the face first
  if (uIntro < 1.0) {
    float at = 0.15 + 0.7 * clamp(length((cf - uGrid * vec2(0.45, 0.42)) / uGrid) * 1.4, 0.0, 1.0) + 0.15 * h;
    if (uIntro < at) {
      if (uIntro < at - 0.25) { o = vec4(0.0); return; }
      best = 1 + int(mod(floor(uTime * 22.0 + h * 90.0), ${NG - 1}.0));
    }
  }
  // cursor: characters near it cycle (never the space)
  float lens = smoothstep(1.0, 0.0, length((cf + 0.5 - uMouse) * vec2(1.0, ${CELL_ASPECT})) / uLensR);
  if (lens > 0.15 && best > 0 && gone < 0.5) best = 1 + int(mod(float(best) + floor(uTime * 12.0 + h * 40.0), ${NG - 1}.0));
  if (e > 0.98) { o = vec4(0.0); return; }
  float acc = max(lens, gone * 0.35);
  o = vec4(float(best) / 255.0, lum * (1.0 - e), acc, rim * (1.0 - 0.6 * uDis) * (1.0 - e));
}`;

// pass 2: full canvas, crisp characters, premultiplied alpha over the page (no backing, no box).
// A soft cyan glow around lit characters grows as the portrait dissolves.
const DRAW = `#version 300 es
precision highp float;
uniform sampler2D uCells, uAtlas;
uniform vec2 uOrigin, uCell, uGrid;
uniform float uH, uGlow;
uniform vec3 uPaper, uAccent;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) - uOrigin;
  vec2 cf = floor(p / uCell);
  vec3 glow = vec3(0.0);
  if (uGlow > 0.001) {
    for (int j = -1; j <= 1; j++) for (int i = -2; i <= 2; i++) {
      vec2 q = cf + vec2(i, j);
      if (q.x < 0.0 || q.y < 0.0 || q.x >= uGrid.x || q.y >= uGrid.y) continue;
      vec4 n = texelFetch(uCells, ivec2(q), 0);
      if (n.r < 0.002) continue;
      vec2 d = (p - (q + 0.5) * uCell) / uCell.x;
      glow += mix(uPaper * 0.6, uAccent, 0.5) * n.g * exp(-dot(d, d) / 2.2);
    }
    glow *= 0.09 * uGlow;
  }
  if (cf.x < 0.0 || cf.y < 0.0 || cf.x >= uGrid.x || cf.y >= uGrid.y) { o = vec4(glow, max(glow.r, max(glow.g, glow.b))); return; }
  vec4 s = texelFetch(uCells, ivec2(cf), 0);
  int g = int(s.r * 255.0 + 0.5);
  if (g == 0) { o = vec4(glow, max(glow.r, max(glow.g, glow.b))); return; }
  vec2 local = p - cf * uCell;
  float a = texelFetch(uAtlas, ivec2(g * int(uCell.x) + int(local.x), int(local.y)), 0).a;
  // one brightness factor: dim characters in the hair and shadows, full white on the lit skin
  float b = clamp(0.22 + 0.85 * pow(s.g, 0.9), 0.0, 1.0);
  // rim: the back edge takes the cyan light
  vec3 col = mix(uPaper * b, uAccent * (0.85 + 0.35 * b), s.a * 0.9);
  // dust takes a little of the cyan; the cursor lens is full cyan
  float hot = smoothstep(0.5, 1.0, s.b);
  col = mix(col, mix(uPaper, uAccent, 0.45) * b, smoothstep(0.2, 0.4, s.b) * (1.0 - hot));
  col = mix(col, uAccent * 1.15, hot);
  vec3 rgb = col * a + glow * (1.0 - a);
  o = vec4(rgb, max(a, max(rgb.r, max(rgb.g, rgb.b))));
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`${src} failed to load`));
    img.src = src;
  });
}

/** Every printable character at the exact device-pixel cell size, so each is copied pixel for pixel. */
function drawAtlas(cw: number, ch: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw * NG;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${cw / 0.6}px "JetBrains Mono", ui-monospace, monospace`;
  [...CHARS].forEach((chr, i) => g.fillText(chr, i * cw + cw / 2, ch * 0.54));
  return c;
}

export async function startField(host: HTMLElement, opts: Options): Promise<() => void> {
  const [cols, rows] = meta.maps as [number, number];
  const [maps] = await Promise.all([
    loadImage('/field/maps.webp'),
    document.fonts?.load('700 64px "JetBrains Mono"').catch(() => undefined),
  ]);
  const hero = host.closest('section') ?? host;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: 'low-power' });
  if (!gl) throw new Error('no WebGL2');

  const program = async (frag: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    // let the driver compile off the main thread where it can, instead of stalling a frame
    const par = gl.getExtension('KHR_parallel_shader_compile');
    if (par) while (!gl.getProgramParameter(p, par.COMPLETION_STATUS_KHR)) await new Promise((r) => requestAnimationFrame(r));
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    return p;
  };
  const [pick, draw] = await Promise.all([program(PICK), program(DRAW)]);
  const P = (n: string) => gl.getUniformLocation(pick, n);
  const D = (n: string) => gl.getUniformLocation(draw, n);
  const up = {
    maps: P('uMaps'), glyphs: P('uGlyphs'), grid: P('uGrid'), mouse: P('uMouse'), light: P('uLight'), lit: P('uLit'),
    dis: P('uDis'), fade: P('uFade'), time: P('uTime'), intro: P('uIntro'), lensR: P('uLensR'),
  };
  const ud = {
    cells: D('uCells'), atlas: D('uAtlas'), origin: D('uOrigin'), cell: D('uCell'), grid: D('uGrid'), h: D('uH'),
    paper: D('uPaper'), accent: D('uAccent'), glow: D('uGlow'),
  };

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  for (const p of [pick, draw]) {
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  const texture = (unit: number, w: number, h: number, src: TexImageSource | Uint8Array | null) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (src instanceof Uint8Array || src === null) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    return t;
  };
  // unit 0: maps, 1: glyph shape table (NG x 2), 2: atlas, 3: per-cell result of pass 1
  const mapsTex = texture(0, 0, 0, maps);
  const gv = meta.glyphs as number[];
  const gdata = new Uint8Array(NG * 2 * 4);
  for (let g = 0; g < NG; g++) for (let i = 0; i < 6; i++) gdata[((i < 3 ? 0 : NG) + g) * 4 + (i % 3)] = gv[g * 6 + i]!;
  const glyphTex = texture(1, NG, 2, gdata);
  let atlasTex: WebGLTexture | null = null;
  const cellTex = texture(3, cols, rows, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cellTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // theme colours from CSS variables
  const css = getComputedStyle(document.documentElement);
  const rgb = (name: string, fallback: [number, number, number]): [number, number, number] => {
    const m = css.getPropertyValue(name).trim().match(/^#([0-9a-f]{6})$/i);
    return m ? [0, 2, 4].map((k) => parseInt(m[1]!.slice(k, k + 2), 16) / 255) as [number, number, number] : fallback;
  };
  gl.useProgram(pick);
  gl.uniform1i(up.maps, 0);
  gl.uniform1i(up.glyphs, 1);
  gl.uniform2f(up.grid, cols, rows);
  gl.uniform1f(up.lensR, 7);
  gl.useProgram(draw);
  gl.uniform1i(ud.atlas, 2);
  gl.uniform1i(ud.cells, 3);
  gl.uniform2f(ud.grid, cols, rows);
  gl.uniform3f(ud.paper, ...rgb('--portrait-paper', [0.957, 0.961, 0.961]));
  gl.uniform3f(ud.accent, ...rgb('--accent', [0.122, 0.733, 0.824]));

  const dpr = Math.min(window.devicePixelRatio || 1, opts.tier === 'high' ? 2 : 1.5);
  let box = { x: 0, y: 0, w: 1, h: 1, cw: 1, ch: 1 }; // grid rect in CSS px relative to the host
  let W = 1, H = 1;
  const resize = () => {
    W = Math.max(1, Math.round(host.clientWidth * dpr));
    H = Math.max(1, Math.round(host.clientHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    // same box as the still: 2% inset, contained, then snapped to whole device pixels per cell
    const fit = Math.min((W * 0.96) / cols, (H * 0.96) / (rows * CELL_ASPECT));
    const cw = Math.max(2, Math.floor(fit)), ch = Math.max(3, Math.round(cw * CELL_ASPECT));
    const ox = Math.round((W - cw * cols) / 2), oy = Math.round((H - ch * rows) / 2);
    gl.useProgram(draw);
    gl.uniform2f(ud.origin, ox, oy);
    gl.uniform2f(ud.cell, cw, ch);
    gl.uniform1f(ud.h, H);
    if (atlasTex) gl.deleteTexture(atlasTex);
    atlasTex = texture(2, 0, 0, drawAtlas(cw, ch));
    box = { x: ox / dpr, y: oy / dpr, w: (cw * cols) / dpr, h: (ch * rows) / dpr, cw: cw / dpr, ch: ch / dpr };
    wake();
  };

  // light state, in image coords (x right, y down, z towards the viewer)
  const front = [0, 0, 1];
  const light = { cur: [-0.75, -0.55, 0.4], lit: 0 };
  const pointer = { x: -1e5, y: -1e5, last: -1e9, inside: false };
  const fine = window.matchMedia('(pointer: fine)').matches;
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.inside = fine && pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    pointer.last = performance.now();
    wake();
  };
  const onLeave = () => { pointer.inside = false; wake(); };
  const onScroll = () => wake();
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('scroll', onScroll, { passive: true });

  let played = false;
  try {
    played = sessionStorage.getItem('kb.field') === '1';
    sessionStorage.setItem('kb.field', '1');
  } catch {
    /* storage blocked: play the intro every time */
  }
  const t0 = performance.now();
  let raf = 0, visible = true, stopped = false, last = t0, lastScroll = -1;
  let samples: number[] = [];

  const target = (now: number): { l: number[]; lit: number } => {
    if (fine && now - pointer.last < 2600 && pointer.x > -1e4) {
      const cx = box.x + box.w * 0.45, cy = box.y + box.h * 0.42;
      const lx = Math.max(-1.3, Math.min(1.3, (pointer.x - cx) / (box.w * 0.5)));
      const ly = Math.max(-1.3, Math.min(1.3, (pointer.y - cy) / (box.h * 0.5)));
      return { l: [lx * 0.85, ly * 0.75, 0.75], lit: 1 };
    }
    return { l: front, lit: 0 };
  };

  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    samples.push(now - last);
    last = now;
    if (samples.length === 60) {
      opts.onStats?.(samples.reduce((a, b) => a + b, 0) / samples.length);
      samples = [];
    }
    const intro = played ? 1 : Math.min(1, (now - t0) / INTRO_MS);
    const tg = target(now);
    const k = 0.08;
    for (let i = 0; i < 3; i++) light.cur[i]! += (tg.l[i]! - light.cur[i]!) * k;
    light.lit += (tg.lit - light.lit) * k;
    const [lx, ly, lz] = light.cur as [number, number, number];
    const len = Math.hypot(lx, ly, lz) || 1;
    const hr = hero.getBoundingClientRect();
    const sp = scrollProgress(hr.top, hr.height);
    const t = (now - t0) / 1000;

    // pass 1: pick a character per cell
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(pick);
    gl.uniform3f(up.light, lx / len, ly / len, lz / len);
    gl.uniform1f(up.lit, light.lit);
    gl.uniform1f(up.time, t);
    // scroll: the portrait sprinkles into dust over the first 70% of its own height of scrolling, glowing softly,
    // and lingers (drifts down at a third of the scroll speed) while the text moves over it; then it fades out
    const run = Math.max(0, -hr.top) / Math.max(1, host.clientHeight);
    const dis = Math.min(1, run / 0.7);
    gl.uniform1f(up.dis, dis);
    gl.uniform1f(up.fade, Math.min(1, Math.max(0, (run - 0.6) / 0.5)));
    host.style.transform = run > 0 ? `translate3d(0, ${(Math.min(run, 1.2) * host.clientHeight * 0.33).toFixed(1)}px, 0)` : '';
    gl.uniform1f(up.intro, intro);
    const mx = pointer.inside ? (pointer.x - box.x) / box.cw : -1e5;
    const my = pointer.inside ? (pointer.y - box.y) / box.ch : -1e5;
    gl.uniform2f(up.mouse, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass 2: draw them
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(draw);
    gl.uniform1f(ud.glow, 0.25 + 0.75 * Math.min(1, run / 0.6));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!host.classList.contains('live')) host.classList.add('live');

    // keep animating only while something is changing; pointer and scroll events wake it again
    const settling = Math.abs(light.lit - tg.lit) > 0.002 || light.cur.some((v, i) => Math.abs(v - tg.l[i]!) > 0.002);
    const pointerHeld = fine && now - pointer.last < 2600;
    const busy = intro < 1 || settling || pointer.inside || pointerHeld || (sp > 0 && sp < 1) || sp !== lastScroll;
    lastScroll = sp;
    if (busy && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  function wake(): void {
    if (!raf && !stopped && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) wake();
  });
  io.observe(host);
  const onVis = () => (document.hidden ? undefined : wake());
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  host.append(canvas);
  resize();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    host.classList.remove('live');
    host.style.transform = '';
    for (const t of [mapsTex, glyphTex, cellTex, atlasTex]) if (t) gl!.deleteTexture(t);
    gl!.deleteFramebuffer(fbo);
    gl!.deleteBuffer(vbo);
    gl!.deleteProgram(pick);
    gl!.deleteProgram(draw);
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
