// Smooth scrolling with Lenis (about 4 KB). Off for reduced motion or when the visitor pauses motion.
import Lenis from 'lenis';
import { motionAllowed } from './motion';

let lenis: Lenis | null = null;
let raf = 0;

function loop(t: number): void {
  lenis?.raf(t);
  raf = requestAnimationFrame(loop);
}

function start(): void {
  if (lenis || !motionAllowed()) return;
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95, anchors: { offset: -72 } });
  raf = requestAnimationFrame(loop);
}

function stop(): void {
  cancelAnimationFrame(raf);
  lenis?.destroy();
  lenis = null;
}

export function initSmooth(): void {
  // touch devices keep native scrolling (it already feels right and Lenis leaves touch alone by default)
  if (!window.matchMedia('(pointer: fine)').matches) return;
  start();
  window.addEventListener('kb:motion', ((e: CustomEvent<{ paused: boolean }>) => (e.detail.paused ? stop() : start())) as EventListener);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', (e) => e.persisted && start());
}
