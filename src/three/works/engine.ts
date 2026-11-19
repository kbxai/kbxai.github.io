// Project figures in 3D, drawn in the hero portrait's own material: every glyph sits in a fixed cell
// (JetBrains Mono 700, the portrait's measured ramp), and only the geometry underneath moves.
// One WebGL2 renderer serves every row: each visible figure is rendered into a low-res scene target
// (two samples per cell each way), turned into glyphs by a full-screen pass, then copied to that
// row's own 2D canvas, so the figures scroll with the page natively and never lag behind it.
import {
  WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, Mesh, BufferGeometry, BufferAttribute,
  ShaderMaterial, CanvasTexture, NearestFilter, LinearFilter, Vector3, PCFShadowMap,
} from 'three';
import meta from '../../data/field-meta.json';
import { SCENES, type Work } from './scenes';

const RAMP = meta.ramp;
const CELL_ASPECT = 1.6;

interface Opts { still: boolean }

interface Slot {
  host: HTMLElement;
  slug: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  work: Work;
  visible: boolean;
  p: number; q: number; // damped scroll progress: in (0 -> settled) and out (0 -> gone)
  w: number; h: number; cols: number; rows: number; cw: number; ch: number; ox: number; oy: number;
  target: WebGLRenderTarget | null;
  pointer: { x: number; y: number; on: boolean; k: number };
  labels: HTMLElement[];
}

const GLYPH_VERT = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// A cell reads its four scene samples: R = light on plain surfaces, G = light on the accent, B = light on the
// floor, A = coverage. The floor only shows inside a soft pool of light (uPool: centre and radii in grid units),
// so a figure has no box: it sits on the page the way the portrait does.
const GLYPH_FRAG = `
precision highp float;
uniform sampler2D uScene, uAtlas;
uniform vec2 uGrid, uCell, uOrigin;
uniform vec4 uPool;
uniform float uN, uH;
uniform vec3 uPaper, uAccent, uInk;

float pool(vec2 c) {
  vec2 d = ((c + 0.5) / uGrid - uPool.xy) / uPool.zw;
  return smoothstep(1.0, 0.35, length(d));
}

vec4 cell(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uGrid.x) || c.y >= int(uGrid.y)) return vec4(0.0);
  ivec2 b = ivec2(c.x * 2, (int(uGrid.y) - 1 - c.y) * 2);
  vec4 s = texelFetch(uScene, b, 0) + texelFetch(uScene, b + ivec2(1, 0), 0)
         + texelFetch(uScene, b + ivec2(0, 1), 0) + texelFetch(uScene, b + ivec2(1, 1), 0);
  s *= 0.25;
  s.b *= pool(vec2(c));
  return s;
}
// tone 0..1 and accent share of a cell
vec2 tone(vec4 s) {
  float lum = max(max(s.r, s.g), s.b);
  return vec2(clamp(lum, 0.0, 1.0), s.g / max(lum, 1e-4));
}
vec3 tint(float t, float acc) {
  float e = clamp((t - 0.04) / 0.74, 0.0, 1.0);
  vec3 col = uPaper * (0.14 + 0.86 * e * e * (3.0 - 2.0 * e));
  return mix(col, uAccent * (0.55 + 0.6 * e), clamp(acc, 0.0, 1.0));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) - uOrigin;
  vec2 cf = floor(p / uCell);
  ivec2 c = ivec2(cf);

  // soft glow from nearby cells, as on the portrait
  vec3 glow = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -2; i <= 2; i++) {
    vec4 q = cell(c + ivec2(i, j));
    if (q.a < 0.01) continue;
    vec2 d = (p - (cf + vec2(i, j) + 0.5) * uCell) / uCell.x;
    vec2 tq = tone(q);
    glow += tint(tq.x, tq.y) * exp(-dot(d, d) / 1.62) * q.a * smoothstep(0.1, 0.9, tq.x);
  }
  glow *= 0.055;

  vec4 s = cell(c);
  vec2 t = tone(s);
  float v = t.x * smoothstep(0.0, 0.5, s.a);
  float g = floor(clamp(v, 0.0, 1.0) * (uN - 1.0) + 0.5);
  if (s.a < 0.02 || g < 1.0) { gl_FragColor = vec4(uInk + glow, 1.0); return; }

  vec2 local = p - cf * uCell;
  float a = texelFetch(uAtlas, ivec2(int(g) * int(uCell.x) + int(local.x), int(local.y)), 0).a;
  float alpha = a * clamp(0.35 + 1.1 * v, 0.0, 1.0);
  vec3 col = tint(v, t.y);
  gl_FragColor = vec4(mix(uInk + glow, col, alpha), 1.0);
}`;

/** Glyph strip at the exact device-pixel cell size (same drawing as the portrait's atlas). */
function drawAtlas(cw: number, ch: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw * RAMP.length;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${cw / 0.6}px "JetBrains Mono", ui-monospace, monospace`;
  [...RAMP].forEach((chr, i) => g.fillText(chr, i * cw + cw / 2, ch * 0.54));
  return c;
}

// theme colours as raw sRGB values: the glyph pass writes straight to the canvas, with no colour conversion
const hex = (name: string, fb: string): Vector3 => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = (/^#([0-9a-f]{6})$/i.exec(v) ?? /^#([0-9a-f]{6})$/i.exec(fb))!;
  return new Vector3(...[0, 2, 4].map((k) => parseInt(m[1]!.slice(k, k + 2), 16) / 255));
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export async function startWorks(hosts: HTMLElement[], opts: Opts): Promise<() => void> {
  await document.fonts?.load('700 32px "JetBrains Mono"').catch(() => undefined);
  const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.autoClear = true;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(1);

  const ink = hex('--ink', '#050606');
  const glyphMat = new ShaderMaterial({
    vertexShader: GLYPH_VERT,
    fragmentShader: GLYPH_FRAG,
    uniforms: {
      uScene: { value: null }, uAtlas: { value: null }, uGrid: { value: [1, 1] }, uCell: { value: [1, 1] },
      uOrigin: { value: [0, 0] }, uN: { value: RAMP.length }, uH: { value: 1 }, uPool: { value: [0.5, 0.55, 0.5, 0.48] },
      uPaper: { value: hex('--paper', '#f4f5f5') }, uAccent: { value: hex('--accent', '#1fbbd2') }, uInk: { value: ink },
    },
    depthTest: false, depthWrite: false,
  });
  const tri = new BufferGeometry();
  tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const glyphScene = new Scene();
  const quad = new Mesh(tri, glyphMat);
  quad.frustumCulled = false;
  glyphScene.add(quad);
  const glyphCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let atlas: CanvasTexture | null = null;
  let atlasKey = '';
  let canvasW = 0, canvasH = 0;

  const slots: Slot[] = [];
  for (const host of hosts) {
    const slug = host.dataset.w3d!;
    const make = SCENES[slug];
    if (!make) continue;
    const work = await make();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'w3d-canvas';
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const labels = (work.labels ?? []).map((l) => {
      const el = document.createElement('span');
      el.className = `w3d-label${l.accent ? ' accent' : ''}`;
      el.setAttribute('aria-hidden', 'true');
      el.textContent = l.text;
      host.append(el);
      return el;
    });
    host.prepend(canvas);
    slots.push({
      host, slug, canvas, ctx, work, visible: false, p: opts.still ? 1 : 0, q: 0,
      w: 1, h: 1, cols: 1, rows: 1, cw: 1, ch: 1, ox: 0, oy: 0, target: null,
      pointer: { x: 0, y: 0, on: false, k: 0 }, labels,
    });
  }

  const layout = (s: Slot) => {
    const r = s.host.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    s.w = W; s.h = H;
    s.canvas.width = W; s.canvas.height = H;
    // the portrait's cell size: 5 x 8 CSS px on a desktop, a little smaller on phones
    const cssCell = r.width < 520 ? 4 : 5;
    s.cw = Math.max(3, Math.round(cssCell * dpr));
    s.ch = Math.round(s.cw * CELL_ASPECT);
    s.cols = Math.floor(W / s.cw); s.rows = Math.floor(H / s.ch);
    s.ox = Math.round((W - s.cols * s.cw) / 2); s.oy = Math.round((H - s.rows * s.ch) / 2);
    s.target?.dispose();
    s.target = new WebGLRenderTarget(s.cols * 2, s.rows * 2, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
    s.work.camera.aspect = (s.cols * s.cw) / (s.rows * s.ch);
    s.work.camera.updateProjectionMatrix();
    canvasW = Math.max(canvasW, W); canvasH = Math.max(canvasH, H);
  };
  const relayout = () => {
    canvasW = 0; canvasH = 0;
    slots.forEach(layout);
    renderer.setSize(canvasW, canvasH, false);
    const key = `${slots[0]?.cw}x${slots[0]?.ch}`;
    if (key !== atlasKey && slots[0]) {
      atlas?.dispose();
      atlas = new CanvasTexture(drawAtlas(slots[0].cw, slots[0].ch));
      atlas.minFilter = LinearFilter; atlas.magFilter = NearestFilter; atlas.generateMipmaps = false;
      atlas.flipY = false;
      atlasKey = key;
    }
    slots.forEach((s) => (s.visible ? wake() : drawOnce(s)));
  };

  // scroll progress: p reaches 1 when the figure's centre sits a little above the middle of the screen,
  // q runs from there until the figure has left the top edge
  const progress = (s: Slot) => {
    const r = s.host.getBoundingClientRect();
    const vh = window.innerHeight;
    const settle = vh * 0.56;
    const p = clamp01((vh - r.top) / Math.max(1, vh - settle + r.height / 2));
    const q = clamp01((settle - (r.top + r.height / 2)) / Math.max(1, settle + r.height / 2));
    return { p, q };
  };

  const v3 = new Vector3();
  const render = (s: Slot, now: number) => {
    if (!s.target || !atlas) return;
    const ptr = s.pointer;
    s.work.update(s.p, s.q, now / 1000, ptr.on || ptr.k > 0.001 ? { x: ptr.x, y: ptr.y, k: ptr.k } : null);
    renderer.setRenderTarget(s.target);
    renderer.setClearColor(0x000000, 0);
    renderer.render(s.work.scene, s.work.camera);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, s.w, s.h);
    renderer.setScissorTest(false);
    const u = glyphMat.uniforms;
    u.uScene!.value = s.target.texture;
    u.uAtlas!.value = atlas;
    u.uGrid!.value = [s.cols, s.rows];
    u.uCell!.value = [s.cw, s.ch];
    u.uOrigin!.value = [s.ox, s.oy];
    u.uH!.value = s.h;
    u.uPool!.value = s.work.pool ?? [0.5, 0.55, 0.5, 0.48];
    renderer.render(glyphScene, glyphCam);
    // the drawing buffer is still intact within this task, so copy the bottom-left W x H region out now
    s.ctx.drawImage(renderer.domElement, 0, canvasH - s.h, s.w, s.h, 0, 0, s.w, s.h);
    // DOM labels pinned to points in the scene: crisp text, readable by nobody but sighted users (aria-hidden)
    const anchors = s.work.labels ?? [];
    const rw = s.w / dpr, rh = s.h / dpr;
    anchors.forEach((a, i) => {
      v3.copy(a.at()).project(s.work.camera);
      const el = s.labels[i]!;
      el.style.transform = `translate(${((v3.x + 1) / 2) * rw}px, ${((1 - v3.y) / 2) * rh}px) translate(-50%, ${a.below ? '6px' : '-100%'})`;
      const inside = Math.abs(v3.x) < 0.94 && Math.abs(v3.y) < 0.94 ? 1 : 0;
      el.style.opacity = String((a.show?.() ?? 1) * inside);
    });
    if (!s.host.classList.contains('w3d-on')) s.host.classList.add('w3d-on');
  };
  const drawOnce = (s: Slot) => {
    if (opts.still) { s.p = 1; s.q = 0; }
    render(s, performance.now());
  };

  let raf = 0, stopped = false, last = performance.now();
  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 6.5);
    let busy = false;
    for (const s of slots) {
      if (!s.visible) continue;
      if (opts.still) { if (!s.host.classList.contains('w3d-on')) drawOnce(s); continue; }
      const t = progress(s);
      const ptr = s.pointer;
      const pk = ptr.k + ((ptr.on ? 1 : 0) - ptr.k) * (1 - Math.exp(-dt * 4));
      const moving = Math.abs(t.p - s.p) > 1e-4 || Math.abs(t.q - s.q) > 1e-4 || Math.abs(pk - ptr.k) > 1e-3 || ptr.on || (s.work.live?.(s.p, s.q) ?? false);
      ptr.k = pk;
      s.p += (t.p - s.p) * k;
      s.q += (t.q - s.q) * k;
      if (moving || !s.host.classList.contains('w3d-on')) render(s, now);
      busy ||= moving;
    }
    if (busy && !document.hidden) raf = requestAnimationFrame(frame);
  };
  function wake(): void {
    if (!raf && !stopped && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = slots.find((x) => x.host === e.target);
      if (!s) continue;
      s.visible = e.isIntersecting;
      if (s.visible) {
        // jump straight to where the scroll is when a figure comes into view after a long jump
        const t = progress(s);
        if (Math.abs(t.p - s.p) > 0.6) { s.p = t.p; s.q = t.q; }
        wake();
      }
    }
  }, { rootMargin: '10% 0px' });

  const fine = window.matchMedia('(pointer: fine)').matches;
  const onPointer = (e: PointerEvent) => {
    if (!fine || opts.still) return;
    for (const s of slots) {
      if (!s.visible) continue;
      const r = s.host.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const on = x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05;
      if (on || s.pointer.on) { s.pointer.x = x * 2 - 1; s.pointer.y = y * 2 - 1; s.pointer.on = on; wake(); }
    }
  };
  const onScroll = () => wake();
  const onVis = () => (document.hidden ? undefined : wake());
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => relayout());
  slots.forEach((s) => { ro.observe(s.host); io.observe(s.host); });
  relayout();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    for (const s of slots) {
      s.target?.dispose();
      s.work.dispose();
      s.canvas.remove();
      s.labels.forEach((l) => l.remove());
      s.host.classList.remove('w3d-on');
    }
    atlas?.dispose();
    glyphMat.dispose(); tri.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
