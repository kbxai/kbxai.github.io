// 3D "KB" monogram rendered as glowing ASCII on the GPU (WebGL2).
// Pipeline: scene -> low-res render target (1 texel per character cell) -> fullscreen glyph-atlas shader.
import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, ExtrudeGeometry, Group,
  Mesh, MeshLambertMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Points,
  PointsMaterial, Scene, Shape, Path, ShaderMaterial, WebGLRenderTarget, WebGLRenderer, SRGBColorSpace,
} from 'three';
import mono from './monogram.json';
import { asciiFragment, asciiVertex, RAMP, cellGrid, dissolveFromScroll } from './ascii-shader';

type Cmd = (string | number)[];
interface Options { tier: 'high' | 'low'; onStats?: (frameMs: number, state?: string) => void }

function toPath<T extends Path>(p: T, cmds: Cmd[]): T {
  for (const c of cmds) {
    const [k, ...n] = c as [string, ...number[]];
    if (k === 'M') p.moveTo(n[0]!, n[1]!);
    else if (k === 'L') p.lineTo(n[0]!, n[1]!);
    else if (k === 'Q') p.quadraticCurveTo(n[0]!, n[1]!, n[2]!, n[3]!);
  }
  return p;
}

function monogram(): Group {
  const g = new Group();
  const mat = new MeshLambertMaterial({ color: 0xffffff });
  for (const s of mono.shapes) {
    const shape = toPath(new Shape(), s.outer as Cmd[]);
    for (const h of s.holes) shape.holes.push(toPath(new Path(), h as Cmd[]));
    const geo = new ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.12, bevelSegments: 2, curveSegments: 8 });
    g.add(new Mesh(geo, mat));
  }
  g.children.forEach((m) => (m as Mesh).geometry.translate(-5, -mono.height / 2, -0.7));
  return g;
}

function dust(count: number): Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 7 + Math.random() * 6;
    const t = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 9;
    pos.set([Math.cos(t) * r, y, Math.sin(t) * r - 2], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  return new Points(geo, new PointsMaterial({ color: 0x5a5a5a, size: 0.07, sizeAttenuation: true }));
}

function glyphAtlas(cell: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = cell * RAMP.length;
  c.height = cell;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.font = `700 ${Math.round(cell * 0.86)}px "JetBrains Mono", ui-monospace, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = cell * 0.18; // glow baked into the atlas, so no bloom pass is needed
  [...RAMP].forEach((ch, i) => g.fillText(ch, i * cell + cell / 2, cell / 2 + 1));
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

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 19);
  scene.add(new AmbientLight(0xffffff, 0.55));
  const key = new DirectionalLight(0xffffff, 2.8);
  key.position.set(-6, 8, 10);
  scene.add(key);
  const rim = new DirectionalLight(0xffffff, 0.8);
  rim.position.set(8, -4, -6);
  scene.add(rim);
  const kb = monogram();
  scene.add(kb);
  const points = dust(opts.tier === 'high' ? 160 : 70);
  scene.add(points);

  let cellPx = opts.tier === 'high' ? 7 : 9;
  const target = new WebGLRenderTarget(2, 2, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
  const atlas = glyphAtlas(32);
  const quadScene = new Scene();
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new ShaderMaterial({
    vertexShader: asciiVertex,
    fragmentShader: asciiFragment,
    transparent: true,
    depthTest: false,
    uniforms: {
      tScene: { value: target.texture },
      tAtlas: { value: atlas },
      uGrid: { value: [2, 2] },
      uGlyphs: { value: RAMP.length },
      uDissolve: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new Color('#7cff8a') },
      uHot: { value: new Color('#ffb454') },
    },
  });
  quadScene.add(new Mesh(new PlaneGeometry(2, 2), material));

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    const { cols, rows } = cellGrid(w, h, cellPx);
    target.setSize(cols, rows);
    material.uniforms.uGrid!.value = [cols, rows];
    camera.aspect = w / h;
    camera.fov = w / h < 1.2 ? 40 : 30;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  host.append(canvas);
  resize();

  let pointerX = 0, pointerY = 0, rx = 0, ry = 0;
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointerX = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointerY = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const onScroll = () => {
    material.uniforms.uDissolve!.value = dissolveFromScroll(window.scrollY, host.getBoundingClientRect().height + host.offsetTop);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  let visible = true;
  let raf = 0;
  let last = performance.now();
  let samples: number[] = [];
  let downgraded = false;
  let stopped = false;

  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    const dt = now - last;
    last = now;
    samples.push(dt);
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
        cellPx += 4;
        resize();
      }
      samples = [];
    }
    const t = now / 1000;
    rx += (pointerY * 0.25 - rx) * 0.06;
    ry += (pointerX * 0.45 + Math.sin(t * 0.4) * 0.25 - ry) * 0.06;
    kb.rotation.set(rx, ry, 0);
    points.rotation.y = t * 0.03;
    material.uniforms.uTime!.value = t;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
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
  play();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    host.classList.remove('live');
    scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as { dispose?: () => void } | undefined;
      mat?.dispose?.();
    });
    quadScene.traverse((o) => (o as Mesh).geometry?.dispose());
    material.dispose();
    atlas.dispose();
    target.dispose();
    renderer.dispose();
    canvas.remove();
  }
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
