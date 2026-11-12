// Experimental (desktop only): a small glyph "fluid" that follows the cursor. 2D canvas, about 100 x 40 cells.
import { motionAllowed } from '../lib/motion';

const RAMP = ' .:-=+*#%@';
let running: (() => void) | null = null;

export function start(): void {
  if (running) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '45' });
  document.body.append(canvas);
  const g = canvas.getContext('2d')!;
  const COLS = 100;
  let rows = 40, cw = 0, ch = 0;
  let dens = new Float32Array(COLS * rows), next = new Float32Array(COLS * rows);
  let vx = 0, vy = 0, px = -1, py = -1;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cw = canvas.width / COLS;
    rows = Math.max(20, Math.round(canvas.height / (cw * 1.6)));
    ch = canvas.height / rows;
    dens = new Float32Array(COLS * rows);
    next = new Float32Array(COLS * rows);
    g.font = `${Math.floor(ch * 0.9)}px "JetBrains Mono", monospace`;
    g.textBaseline = 'top';
  };
  resize();

  const onMove = (e: PointerEvent) => {
    const x = Math.floor(e.clientX / cw), y = Math.floor(e.clientY / ch);
    if (px >= 0) { vx = x - px; vy = y - py; }
    px = x; py = y;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < COLS && cy < rows) dens[cy * COLS + cx] = Math.min(1, dens[cy * COLS + cx]! + 0.35);
      }
  };

  let raf = 0;
  const step = () => {
    // advect slightly along the last cursor velocity, diffuse, decay
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < COLS - 1; x++) {
        const sx = Math.min(COLS - 2, Math.max(1, Math.round(x - vx * 0.3)));
        const sy = Math.min(rows - 2, Math.max(1, Math.round(y - vy * 0.3)));
        const i = sy * COLS + sx;
        const avg = (dens[i]! * 4 + dens[i - 1]! + dens[i + 1]! + dens[i - COLS]! + dens[i + COLS]!) / 8;
        next[y * COLS + x] = avg * 0.94;
      }
    [dens, next] = [next, dens];
    vx *= 0.9; vy *= 0.9;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#7cff8a';
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < COLS; x++) {
        const d = dens[y * COLS + x]!;
        if (d < 0.05) continue;
        g.globalAlpha = Math.min(0.85, d);
        g.fillText(RAMP[Math.min(RAMP.length - 1, Math.floor(d * RAMP.length))]!, x * cw, y * ch);
      }
    g.globalAlpha = 1;
    raf = requestAnimationFrame(step);
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('resize', resize);
    window.removeEventListener('kb:motion', onMotion);
    window.removeEventListener('keydown', onKey);
    canvas.remove();
    running = null;
  };
  const onMotion = () => { if (!motionAllowed()) stop(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('resize', resize);
  window.addEventListener('kb:motion', onMotion);
  window.addEventListener('keydown', onKey);
  running = stop;
  raf = requestAnimationFrame(step);
}
