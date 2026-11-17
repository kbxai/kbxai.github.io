// Decides whether the 3D portrait field may run, then lazy-loads it after the page has loaded.
import { motionAllowed } from './motion';

export type Tier = 'high' | 'low' | 'none';

/** Creating a WebGL2 context is expensive on slow devices, so it only happens when the hero is about to start. */
function probeWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Cheap tier guess for scheduling (no GL context). `probe` adds the real WebGL2 check. */
export function detectTier(probe = false): Tier {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData || !('WebGL2RenderingContext' in window)) return 'none';
  if (probe && !probeWebGL2()) return 'none';
  const cores = navigator.hardwareConcurrency || 2;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (cores < 4 || (mem !== undefined && mem < 3)) return 'low';
  const small = window.matchMedia('(max-width: 820px)').matches;
  return small ? 'low' : 'high';
}

const emit = (detail: Record<string, unknown>) => {
  const w = window as Window & { kbHeroState?: Record<string, unknown> };
  w.kbHeroState = { ...(w.kbHeroState ?? {}), ...detail };
  window.dispatchEvent(new CustomEvent('kb:hero', { detail }));
};

/** Run `fn` once the largest contentful paint has been reported (or after 2.5 s as a fallback). */
function afterLcp(fn: () => void): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    fn();
  };
  try {
    const po = new PerformanceObserver((list) => {
      if (list.getEntries().length) {
        po.disconnect();
        setTimeout(go, 200);
      }
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* no LCP support: fall through to the timer */
  }
  setTimeout(go, 2500);
}

export function maybeStartHero(hostId = 'hero-art'): void {
  const host = document.getElementById(hostId);
  if (!host) return;
  let stop: (() => void) | null = null;
  let starting = false;

  const start = async () => {
    if (stop || starting || !motionAllowed()) return;
    const tier = detectTier(true);
    if (tier === 'none') {
      emit({ state: 'static (no WebGL2)' });
      return;
    }
    starting = true;
    try {
      const { startField } = await import('../three/grid');
      stop = await startField(host, { tier, onStats: (frameMs, state) => emit({ frameMs, state }) });
      emit({ tier: `WebGL2 ${tier}` });
    } catch (err) {
      console.warn('[hero] disabled:', err);
      emit({ state: 'static (error)' });
    } finally {
      starting = false;
    }
  };

  const schedule = () => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const later = (ms: number) => setTimeout(() => (idle ? idle(() => void start(), { timeout: 2000 }) : void start()), ms);
    const tier = detectTier();
    if (tier === 'none') {
      void start(); // reports the static fallback reason right away
      return;
    }
    if (tier === 'high') {
      afterLcp(() => later(900));
      return;
    }
    // phones and low-end machines: wait for a real interaction (or 6 s) so loading never competes with reading
    const events = ['pointerdown', 'keydown', 'touchstart'];
    let kicked = false;
    const kick = () => {
      if (kicked) return;
      kicked = true;
      events.forEach((ev) => window.removeEventListener(ev, kick));
      afterLcp(() => later(300));
    };
    events.forEach((ev) => window.addEventListener(ev, kick, { passive: true, once: true }));
    setTimeout(kick, 6000);
  };

  if (!motionAllowed()) emit({ state: 'static (motion off)' });
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });

  // back/forward cache: the renderer is disposed on pagehide, so start it again when the page is restored
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      stop = null;
      void start();
    }
  });

  window.addEventListener('kb:motion', ((e: CustomEvent<{ paused: boolean }>) => {
    if (e.detail.paused) {
      stop?.();
      stop = null;
      host.classList.remove('live');
      emit({ state: 'static (paused)' });
    } else {
      void start();
    }
  }) as EventListener);
}
