// Hero portrait, grid-locked: every glyph sits in a fixed cell and never moves. Only the light moves.
// One full-screen WebGL2 pass reads public/field/maps.webp (one texel per cell: tone and normal, with the rim
// light in a second block of rows below; made by scripts/portrait/relight.py) and picks a glyph per cell from the same measured ramp as the still image.
// At rest the light faces the camera, so the frame matches the still exactly.
// Intro: a light sweeps across the face. Pointer: the light follows the cursor; glyphs under it turn amber
// and change in place. Scroll: glyphs scramble in place and fade.
import meta from '../data/field-meta.json';
import { scrollProgress } from './field-core';

interface Options { tier: 'high' | 'low'; onStats?: (frameMs: number, state?: string) => void }

const CELL_ASPECT = 1.6;
const INTRO_MS = 2600;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uMaps, uAtlas;
uniform vec2 uOrigin, uCell, uGrid, uMouse;
uniform vec3 uLight;
uniform float uH, uLit, uLensR, uTime, uScroll, uN;
out vec4 o;

const vec3 PAPER = vec3(0.937, 0.914, 0.875);
const vec3 AMBER = vec3(0.965, 0.639, 0.278);

float hash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

vec4 cellAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uGrid.x) || c.y >= int(uGrid.y)) return vec4(0.0);
  vec4 m = texelFetch(uMaps, c, 0);
  m.a = texelFetch(uMaps, c + ivec2(0, int(uGrid.y)), 0).r;
  return m;
}

// relit tone and the light gain (1.0 = same as the still)
vec2 relit(vec4 m) {
  vec2 nxy = m.gb * 2.0 - 1.0;
  vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  float base = 0.35 + 0.65 * max(n.z, 0.0);
  float now = 0.35 + 0.65 * max(dot(n, uLight), 0.0);
  float f = clamp(mix(1.0, now / base, uLit * 0.8), 0.6, 1.45);
  float t = (m.r * 255.0 - 1.0) / 254.0;
  // gamma-style relight: lit areas get brighter without flattening into one glyph
  return vec2(pow(clamp(t, 0.0, 1.0), 1.0 / f), f);
}

vec3 tint(float t, float rim, float f) {
  float e = clamp((t - 0.04) / 0.74, 0.0, 1.0);
  vec3 col = PAPER * (0.12 + 0.88 * e * e * (3.0 - 2.0 * e));
  col = mix(col, AMBER, min(1.0, rim * 0.55));
  return mix(col, AMBER, clamp((f - 1.0) * 0.9, 0.0, 0.35));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) - uOrigin;
  vec2 cf = floor(p / uCell);
  ivec2 c = ivec2(cf);

  // soft glow from nearby cells, weighted by distance in pixels (the still uses a blur of about one cell)
  vec3 glow = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -2; i <= 2; i++) {
    vec4 q = cellAt(c + ivec2(i, j));
    if (q.r == 0.0) continue;
    vec2 d = (p - (cf + vec2(i, j) + 0.5) * uCell) / uCell.x;
    float w = exp(-dot(d, d) / 1.62);
    vec2 r = relit(q);
    glow += tint(r.x, q.a, r.y) * w * clamp(0.35 + 1.1 * r.x, 0.0, 1.0);
  }
  glow *= 0.06;

  // studio glow from the precomputed maps (bilinear): a bloom over bright skin and a warm backlight
  // just outside the silhouette. Both lean towards the side the light comes from.
  vec2 gc = p / uCell;
  vec2 suv = vec2(clamp(gc.x, 0.5, uGrid.x - 0.5) / uGrid.x, (clamp(gc.y, 0.5, uGrid.y - 0.5) + uGrid.y) / (2.0 * uGrid.y));
  vec3 sm = texture(uMaps, suv).rgb;
  float edge = min(min(gc.x, uGrid.x - gc.x), min(gc.y, uGrid.y - gc.y));
  vec2 dir = normalize(gc - vec2(uGrid.x * 0.5, uGrid.y * 0.42) + 1e-4);
  float side = 1.0 + uLit * 0.9 * max(0.0, dot(dir, normalize(uLight.xy + 1e-4))) * length(uLight.xy);
  glow += mix(PAPER, AMBER, 0.35) * sm.g * 0.075 * side;
  glow += AMBER * sm.b * 0.03 * smoothstep(0.0, 5.0, edge) * side;

  float fade = 1.0;
  float h = hash(cf);
  if (uScroll > 0.0) fade = 1.0 - smoothstep(0.15, 1.0, uScroll + (h - 0.5) * 0.3);
  glow *= fade;

  vec4 m = cellAt(c);
  if (m.r == 0.0) { o = vec4(glow, max(glow.r, max(glow.g, glow.b))); return; }

  vec2 r = relit(m);
  float t = r.x;
  float v = max(clamp(0.08 + 0.92 * t, 0.0, 1.0), 0.10);
  float g = floor(v * (uN - 1.0) + 0.5);

  vec2 cc = (cf + 0.5) * uCell;
  float lens = smoothstep(1.0, 0.0, length(cc - (uMouse - uOrigin)) / uLensR);
  if (lens > 0.08) g = mod(g + floor(uTime * 12.0 + h * 40.0), uN);
  if (uScroll > 0.0 && hash(cf + 7.3) < uScroll * 1.4) g = mod(floor(uTime * 9.0 + h * 40.0), uN);

  vec2 local = p - cf * uCell;
  float a = texelFetch(uAtlas, ivec2(int(g) * int(uCell.x) + int(local.x), int(local.y)), 0).a;
  vec3 col = mix(tint(t, m.a, r.y), AMBER * 1.12, lens);
  float alpha = a * clamp(0.35 + 1.1 * t + 0.4 * m.a, 0.0, 1.0) * fade;
  vec3 rgb = col * alpha + glow * (1.0 - alpha);
  o = vec4(rgb, max(alpha, max(rgb.r, max(rgb.g, rgb.b))));
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

/** Glyph strip at the exact device-pixel cell size, so each glyph is copied pixel for pixel. */
function drawAtlas(ramp: string, cw: number, ch: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw * ramp.length;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${cw / 0.6}px "JetBrains Mono", ui-monospace, monospace`;
  [...ramp].forEach((chr, i) => g.fillText(chr, i * cw + cw / 2, ch * 0.54));
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

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    maps: U('uMaps'), atlas: U('uAtlas'), origin: U('uOrigin'), cell: U('uCell'), grid: U('uGrid'), mouse: U('uMouse'),
    light: U('uLight'), h: U('uH'), lit: U('uLit'), lensR: U('uLensR'), time: U('uTime'), scroll: U('uScroll'), n: U('uN'),
  };

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const texture = (unit: number, src: TexImageSource, filter: number = gl.NEAREST) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const mapsTex = texture(0, maps, gl.LINEAR);
  let atlasTex: WebGLTexture | null = null;
  gl.uniform1i(u.maps, 0);
  gl.uniform1i(u.atlas, 1);
  gl.uniform2f(u.grid, cols, rows);
  gl.uniform1f(u.n, meta.ramp.length);

  const dpr = Math.min(window.devicePixelRatio || 1, opts.tier === 'high' ? 2 : 1.5);
  let box = { x: 0, y: 0, w: 1, h: 1 }; // grid rect in CSS px relative to the host
  const resize = () => {
    const W = Math.max(1, Math.round(host.clientWidth * dpr)), H = Math.max(1, Math.round(host.clientHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
    // same box as the still: 2% inset, contained, then snapped to whole device pixels per cell
    const fit = Math.min((W * 0.96) / cols, (H * 0.96) / (rows * CELL_ASPECT));
    const cw = Math.max(2, Math.floor(fit)), ch = Math.max(3, Math.round(cw * CELL_ASPECT));
    const ox = Math.round((W - cw * cols) / 2), oy = Math.round((H - ch * rows) / 2);
    gl.uniform2f(u.origin, ox, oy);
    gl.uniform2f(u.cell, cw, ch);
    gl.uniform1f(u.h, H);
    gl.uniform1f(u.lensR, cw * 9);
    if (atlasTex) gl.deleteTexture(atlasTex);
    atlasTex = texture(1, drawAtlas(meta.ramp, cw, ch));
    box = { x: ox / dpr, y: oy / dpr, w: (cw * cols) / dpr, h: (ch * rows) / dpr };
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
    const intro = played ? 1 : Math.min(1, (now - t0) / INTRO_MS);
    if (intro < 1) {
      // sweep from upper left, across, and settle facing the camera
      const a = intro * Math.PI;
      return { l: [-Math.cos(a) * 0.8, -0.45 * Math.sin(a) - 0.2 * (1 - intro), 0.45 + 0.55 * intro * intro], lit: Math.sin(Math.min(1, intro * 1.2) * Math.PI * 0.5) * (1 - intro * intro * 0.6) };
    }
    if (fine && now - pointer.last < 2600 && pointer.x > -1e4) {
      const cx = box.x + box.w / 2, cy = box.y + box.h * 0.42;
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
    const tg = target(now);
    const introRunning = !played && now - t0 < INTRO_MS;
    const k = introRunning ? 0.35 : 0.08;
    for (let i = 0; i < 3; i++) light.cur[i]! += (tg.l[i]! - light.cur[i]!) * k;
    light.lit += (tg.lit - light.lit) * k;
    const [lx, ly, lz] = light.cur as [number, number, number];
    const len = Math.hypot(lx, ly, lz) || 1;
    const hr = hero.getBoundingClientRect();
    const sp = scrollProgress(hr.top, hr.height);

    gl.uniform3f(u.light, lx / len, ly / len, lz / len);
    gl.uniform1f(u.lit, light.lit);
    gl.uniform1f(u.time, (now - t0) / 1000);
    gl.uniform1f(u.scroll, sp);
    gl.uniform2f(u.mouse, pointer.inside ? pointer.x * dpr : -1e5, pointer.inside ? pointer.y * dpr : -1e5);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!host.classList.contains('live')) host.classList.add('live');

    // keep animating only while something is changing; pointer and scroll events wake it again
    const settling = Math.abs(light.lit - tg.lit) > 0.002 || light.cur.some((v, i) => Math.abs(v - tg.l[i]!) > 0.002);
    const pointerHeld = fine && now - pointer.last < 2600;
    const busy = introRunning || settling || pointer.inside || pointerHeld || (sp > 0 && sp < 1) || sp !== lastScroll;
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
    gl!.deleteTexture(mapsTex);
    if (atlasTex) gl!.deleteTexture(atlasTex);
    gl!.deleteBuffer(vbo);
    gl!.deleteProgram(prog);
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
