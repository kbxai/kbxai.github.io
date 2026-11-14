// Hero portrait: Kartik's photo as a 3D cloud of measured glyphs (data from scripts/portrait/micro.py).
// Intro: glyphs fly in and settle. Pointer: the head tilts and a lens parts the glyphs. Scroll: it drifts apart.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Group, LinearFilter, LinearMipmapLinearFilter,
  PerspectiveCamera, Points, Scene, ShaderMaterial, Vector2, WebGLRenderer,
} from 'three';
import meta from '../data/field-meta.json';
import { decodeField, fitDistance, introProgress, scrollProgress } from './field-core';

interface Options { tier: 'high' | 'low'; onStats?: (frameMs: number, state?: string) => void }

const FOV = 28;

const vertex = /* glsl */ `
  attribute vec4 aData; attribute float aGlyph;
  uniform float uTime, uIntro, uScroll, uAspect, uSize, uN, uGlow;
  uniform vec2 uMouse;
  varying float vTone, vRim, vAlpha, vLens, vGlyph;
  void main() {
    vec3 p = position;
    float r = aData.w;
    vec3 dir = normalize(vec3(sin(r * 91.3 + 1.0), cos(r * 47.1), sin(r * 13.7 + 2.0)) + 1e-4);
    vec3 start = p * 1.8 + dir * (0.5 + r * 0.9);
    float k = clamp(uIntro * 1.7 - r * 0.55 - aData.z * 0.15, 0.0, 1.0);
    k = 1.0 - pow(1.0 - k, 3.0);
    p = mix(start, p, k);
    float s = clamp(uScroll * 1.5 - r * 0.5, 0.0, 1.0);
    s = s * s * (3.0 - 2.0 * s);
    p += vec3(sin(p.y * 9.0 + uTime * 0.6 + r * 6.28), cos(p.x * 7.0 + uTime * 0.45 + r * 3.0), sin(r * 20.0 + uTime * 0.3)) * 0.22 * s;
    p.y += s * (0.25 + 0.5 * r);
    p.z += s * (r - 0.4) * 0.9;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 d = clip.xy / clip.w - uMouse;
    d.x *= uAspect;
    float lens = smoothstep(0.2, 0.0, length(d)) * k * (1.0 - s);
    clip.xy += normalize(d + 1e-5) / vec2(uAspect, 1.0) * lens * 0.03 * clip.w;
    gl_Position = clip;
    gl_PointSize = uSize / -mv.z * (uGlow > 0.5 ? 3.2 : 1.0 + lens * 0.35);
    vTone = aData.x; vRim = aData.y; vLens = lens;
    vGlyph = lens > 0.05 ? mod(aGlyph + floor(uTime * 14.0 + r * 40.0), uN) : aGlyph;
    vAlpha = k * (1.0 - s * 0.85);
  }`;

const glyphFrag = /* glsl */ `
  uniform sampler2D uAtlas;
  varying float vTone, vRim, vAlpha, vLens, vGlyph;
  void main() {
    vec2 cell = vec2(mod(vGlyph, 4.0), floor(vGlyph / 4.0));
    float a = texture2D(uAtlas, (cell + gl_PointCoord) / 4.0).r;
    if (a < 0.04) discard;
    vec3 paper = vec3(0.937, 0.914, 0.875), amber = vec3(0.965, 0.639, 0.278);
    vec3 col = paper * (0.12 + 0.88 * smoothstep(0.04, 0.78, vTone));
    col = mix(col, amber, clamp(vRim * 0.55, 0.0, 1.0));
    col = mix(col, amber * 1.2, vLens);
    gl_FragColor = vec4(col, a * vAlpha * clamp(0.35 + 1.1 * vTone + vRim * 0.4, 0.0, 1.0));
  }`;

const glowFrag = /* glsl */ `
  varying float vTone, vRim, vAlpha, vLens, vGlyph;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float g = exp(-dot(d, d) * 20.0);
    vec3 warm = mix(vec3(0.94, 0.88, 0.80), vec3(0.965, 0.64, 0.28), clamp(vRim + vLens, 0.0, 1.0));
    float k = (smoothstep(0.4, 0.9, vTone) * 0.045 + vRim * 0.03 + vLens * 0.08) * vAlpha;
    gl_FragColor = vec4(warm * g * k, 1.0);
  }`;

function glyphAtlas(ramp: string): CanvasTexture {
  const A = 512, C = A / 4;
  const c = document.createElement('canvas');
  c.width = c.height = A;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${C * 0.98}px "JetBrains Mono", ui-monospace, monospace`;
  [...ramp].forEach((ch, i) => g.fillText(ch, ((i % 4) + 0.5) * C, (Math.floor(i / 4) + 0.54) * C));
  const t = new CanvasTexture(c);
  t.flipY = false;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

export async function startField(host: HTMLElement, opts: Options): Promise<() => void> {
  const [buf] = await Promise.all([
    fetch('/field/points.bin').then((r) => {
      if (!r.ok) throw new Error(`points.bin ${r.status}`);
      return r.arrayBuffer();
    }),
    document.fonts?.load('700 64px "JetBrains Mono"').catch(() => undefined),
  ]);
  const field = decodeField(buf, meta);
  const hero = host.closest('section') ?? host;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(window.devicePixelRatio || 1, opts.tier === 'high' ? 2 : 1.5);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(field.positions, 3));
  geo.setAttribute('aData', new BufferAttribute(field.data, 4));
  geo.setAttribute('aGlyph', new BufferAttribute(field.glyph, 1));
  const atlas = glyphAtlas(meta.ramp);
  const shared = {
    uTime: { value: 0 }, uIntro: { value: 0 }, uScroll: { value: 0 }, uMouse: { value: new Vector2(9, 9) },
    uAspect: { value: 1 }, uSize: { value: 1 }, uN: { value: meta.ramp.length }, uAtlas: { value: atlas },
  };
  const mat = new ShaderMaterial({ uniforms: { ...shared, uGlow: { value: 0 } }, vertexShader: vertex, fragmentShader: glyphFrag, transparent: true, depthWrite: false });
  const glowMat = new ShaderMaterial({
    uniforms: { ...shared, uGlow: { value: 1 } }, vertexShader: vertex, fragmentShader: glowFrag,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const scene = new Scene();
  const group = new Group();
  const glow = new Points(geo, glowMat);
  glow.renderOrder = -1;
  group.add(glow, new Points(geo, mat));
  scene.add(group);
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 20);

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0, fitDistance(meta.aspect, w / h, FOV));
    camera.updateProjectionMatrix();
    shared.uSize.value = (meta.aspect / meta.rows) * 1.05 * camera.projectionMatrix.elements[5]! * (h * dpr) / 2;
    shared.uAspect.value = camera.aspect;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  host.append(canvas);
  resize();

  const mouse = { x: 0, y: 0, tx: 0, ty: 0, lx: 9, ly: 9 };
  const fine = window.matchMedia('(pointer: fine)').matches;
  const onPointer = (e: PointerEvent) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    const r = host.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    mouse.lx = inside && fine ? ((e.clientX - r.left) / r.width) * 2 - 1 : 9;
    mouse.ly = inside && fine ? -(((e.clientY - r.top) / r.height) * 2 - 1) : 9;
  };
  const onLeave = () => { mouse.lx = mouse.ly = 9; };
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('pointerleave', onLeave);

  let played = false;
  try {
    played = sessionStorage.getItem('kb.field') === '1';
    sessionStorage.setItem('kb.field', '1');
  } catch {
    /* storage blocked: play the intro every time */
  }
  const t0 = performance.now();
  let raf = 0, visible = true, stopped = false, last = t0, downgraded = false;
  let samples: number[] = [];

  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    samples.push(now - last);
    last = now;
    if (samples.length === 60) {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      opts.onStats?.(avg);
      if (avg > 40 && downgraded) {
        stop();
        opts.onStats?.(avg, 'static (too slow)');
        return;
      }
      if (avg > 26 && !downgraded) {
        downgraded = true;
        dpr = 1;
        resize();
      }
      samples = [];
    }
    const t = (now - t0) / 1000;
    const hr = hero.getBoundingClientRect();
    shared.uTime.value = t;
    shared.uIntro.value = played ? 1 : introProgress(now - t0);
    shared.uScroll.value = scrollProgress(hr.top, hr.height);
    mouse.x += (mouse.tx - mouse.x) * 0.07;
    mouse.y += (mouse.ty - mouse.y) * 0.07;
    group.rotation.y = (fine ? mouse.x * 0.2 : Math.sin(t * 0.4) * 0.08) + Math.sin(t * 0.35) * 0.03;
    group.rotation.x = fine ? -mouse.y * 0.09 : 0;
    shared.uMouse.value.set(mouse.lx, mouse.ly);
    renderer.render(scene, camera);
    if (!host.classList.contains('live')) host.classList.add('live');
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const play = () => {
    if (!raf && !stopped && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) play();
  });
  io.observe(host);
  const onVis = () => (document.hidden ? undefined : play());
  document.addEventListener('visibilitychange', onVis);
  play();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    host.classList.remove('live');
    geo.dispose();
    mat.dispose();
    glowMat.dispose();
    atlas.dispose();
    renderer.dispose();
    canvas.remove();
  }
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
