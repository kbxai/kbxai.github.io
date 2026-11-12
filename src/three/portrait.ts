// ASCII self-portrait hero: one fullscreen quad samples a pre-computed map texture (no 3D scene).
import {
  CanvasTexture, Color, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  SRGBColorSpace, TextureLoader, WebGLRenderer,
} from 'three';
import { ATLAS, FILL, bootProgress, portraitFragment, portraitVertex } from './portrait-shader';
import { dissolveFromScroll } from './ascii-shader';
import meta from '../data/portrait-meta.json';
import { portraitGrid } from './portrait-shader';

interface Options { tier: 'high' | 'low'; onStats?: (frameMs: number, state?: string) => void }

const CELL_ASPECT = 1.6; // must match scripts/portrait/render.py

function glyphAtlas(cell: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = cell * ATLAS.length;
  c.height = cell;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.font = `700 ${Math.round(cell * 0.9)}px "JetBrains Mono", ui-monospace, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = cell * 0.16;
  [...ATLAS].forEach((ch, i) => g.fillText(ch, i * cell + cell / 2, cell / 2 + 1));
  const tex = new CanvasTexture(c);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function startHero(host: HTMLElement, opts: Options): () => void {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const atlas = glyphAtlas(32);
  let onMapsReady = () => {};
  const src = opts.tier === 'high' ? meta.maps : meta['maps-lo'];
  const file = opts.tier === 'high' ? 'maps' : 'maps-lo';
  const maps = new TextureLoader().load(`/portrait/${file}.png`, () => onMapsReady());
  maps.minFilter = maps.magFilter = NearestFilter;
  maps.generateMipmaps = false;
  maps.flipY = true;

  const material = new ShaderMaterial({
    vertexShader: portraitVertex,
    fragmentShader: portraitFragment,
    transparent: true,
    depthTest: false,
    uniforms: {
      tMaps: { value: maps },
      tAtlas: { value: atlas },
      uGrid: { value: [2, 2] },
      uFit: { value: [1, 1] },
      uGlyphs: { value: ATLAS.length },
      uFill: { value: FILL.length },
      uBoot: { value: 0 },
      uDissolve: { value: 0 },
      uTime: { value: 0 },
      uPointer: { value: [0, 0] },
      uMouseCell: { value: [-999, -999] },
      uRipple: { value: opts.tier === 'high' ? 9 : 6 },
      uFillColor: { value: new Color('#7cff8a') },
      uEdgeColor: { value: new Color('#ffb454') },
    },
  });
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let cols = 2, rows = 2;
  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    const g = portraitGrid(w, h, src.cols, src.rows, CELL_ASPECT);
    cols = g.cols;
    rows = g.rows;
    material.uniforms.uGrid!.value = [cols, rows];
    material.uniforms.uFit!.value = [g.fitX, g.fitY];
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  host.append(canvas);
  resize();

  let px = 0, py = 0, sx = 0, sy = 0;
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    px = (u - 0.5) * 2;
    py = (0.5 - v) * 2;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    material.uniforms.uMouseCell!.value = inside ? [Math.floor(u * cols), Math.floor((1 - v) * rows)] : [-999, -999];
  };
  const onLeave = () => (material.uniforms.uMouseCell!.value = [-999, -999]);
  window.addEventListener('pointermove', onPointer, { passive: true });
  host.addEventListener('pointerleave', onLeave);

  const onScroll = () => {
    material.uniforms.uDissolve!.value = dissolveFromScroll(window.scrollY, host.getBoundingClientRect().height + host.offsetTop);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  let booted = false;
  try {
    booted = sessionStorage.getItem('kb.face') === '1';
    sessionStorage.setItem('kb.face', '1');
  } catch {
    /* ignore */
  }
  const t0 = performance.now();
  let visible = true, raf = 0, last = t0, stopped = false, downgraded = false;
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
      if (avg > 28 && !downgraded) {
        downgraded = true;
        renderer.setPixelRatio(1);
        resize();
      }
      samples = [];
    }
    sx += (px - sx) * 0.08;
    sy += (py - sy) * 0.08;
    const u = material.uniforms;
    u.uTime!.value = now / 1000;
    u.uBoot!.value = booted ? 1 : bootProgress(now - t0);
    u.uPointer!.value = [sx, sy];
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
  const io = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    if (visible) play();
  });
  io.observe(host);
  const onVis = () => (document.hidden ? undefined : play());
  document.addEventListener('visibilitychange', onVis);
  // start rendering once the map texture is in (avoids an empty first frame)
  onMapsReady = play;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    host.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    host.classList.remove('live');
    material.dispose();
    atlas.dispose();
    maps.dispose();
    scene.traverse((o) => (o as Mesh).geometry?.dispose());
    renderer.dispose();
    canvas.remove();
  }
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
