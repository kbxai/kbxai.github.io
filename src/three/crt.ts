// Experimental (desktop only): fly into a 3D CRT whose screen shows the terminal. Opens as a dialog; Esc closes.
import {
  BoxGeometry, CanvasTexture, Mesh, MeshBasicMaterial, MeshLambertMaterial, AmbientLight, DirectionalLight,
  PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer, SRGBColorSpace, Group,
} from 'three';
import profile from '../data/profile.json';
import projects from '../data/projects.json';

let open = false;

function screenTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 768;
  const g = c.getContext('2d')!;
  g.fillStyle = '#041006';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '700 30px "JetBrains Mono", monospace';
  g.fillStyle = '#7cff8a';
  g.shadowColor = '#7cff8a';
  g.shadowBlur = 8;
  const lines = [
    'kbxai-os v2026.11 (tty1)', '', `visitor@kbxai:~$ whoami`, profile.name, profile.headline, '',
    'visitor@kbxai:~$ ls projects', ...projects.map((p) => `  ${p.slug}`), '', 'visitor@kbxai:~$ _',
  ];
  lines.forEach((l, i) => g.fillText(l, 48, 70 + i * 40));
  for (let y = 0; y < c.height; y += 4) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y, c.width, 2);
  }
  return new CanvasTexture(c);
}

export function start(): void {
  if (open) return;
  open = true;
  const prevFocus = document.activeElement as HTMLElement | null;
  const dlg = document.createElement('div');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-label', 'Experimental 3D CRT');
  Object.assign(dlg.style, { position: 'fixed', inset: '0', zIndex: '60', background: '#020402' });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'close [esc]';
  close.className = 'btn';
  Object.assign(close.style, { position: 'absolute', top: '16px', right: '16px', zIndex: '2', background: '#0b0f0c' });
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  dlg.append(close, canvas);
  document.body.append(dlg);
  close.focus();

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new AmbientLight(0xffffff, 0.4));
  const d = new DirectionalLight(0xffffff, 1.6);
  d.position.set(-3, 4, 5);
  scene.add(d);
  const crt = new Group();
  const bodyMat = new MeshLambertMaterial({ color: 0x2b2f2a });
  crt.add(new Mesh(new BoxGeometry(4.4, 3.6, 3.4), bodyMat));
  const tex = screenTexture();
  const screen = new Mesh(new PlaneGeometry(3.6, 2.7), new MeshBasicMaterial({ map: tex }));
  screen.position.z = 1.71;
  crt.add(screen);
  const stand = new Mesh(new BoxGeometry(2.2, 0.3, 2.2), bodyMat);
  stand.position.y = -1.95;
  crt.add(stand);
  scene.add(crt);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const t0 = performance.now();
  let raf = 0;
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const loop = (now: number) => {
    const t = Math.min(1, (now - t0) / 3200);
    const k = ease(t);
    camera.position.set(-6 * (1 - k), 2.5 * (1 - k), 14 - 10.6 * k);
    camera.lookAt(0, 0, 1.7);
    crt.rotation.y = 0.35 * (1 - k);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const shut = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey);
    scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as { dispose?: () => void } | undefined)?.dispose?.();
    });
    tex.dispose();
    renderer.dispose();
    dlg.remove();
    open = false;
    prevFocus?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') shut();
    if (e.key === 'Tab') { e.preventDefault(); close.focus(); }
  };
  close.addEventListener('click', shut);
  window.addEventListener('keydown', onKey);
}
