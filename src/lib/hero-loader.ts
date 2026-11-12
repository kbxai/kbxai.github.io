// Decides whether the 3D ASCII hero may run, then lazy-loads it after the page has loaded.
import { motionAllowed } from './motion';

export type Tier = 'high' | 'low' | 'none';

export function detectTier(): Tier {
  try {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return 'none';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return 'none';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'none';
  }
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

export function maybeStartHero(hostId = 'hero-art'): void {
  const host = document.getElementById(hostId);
  if (!host) return;
  let stop: (() => void) | null = null;
  let starting = false;

  const start = async () => {
    if (stop || starting || !motionAllowed()) return;
    const tier = detectTier();
    if (tier === 'none') {
      emit({ state: 'static (no WebGL2)' });
      return;
    }
    starting = true;
    try {
      const { startHero } = await import('../three/portrait');
      stop = startHero(host, { tier, onStats: (frameMs, state) => emit({ frameMs, state }) });
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
      later(1200);
      return;
    }
    // phones and low-end machines: wait for the first interaction (or 6 s) so loading never competes with reading
    const kick = () => {
      ['pointerdown', 'scroll', 'keydown', 'touchstart'].forEach((ev) => window.removeEventListener(ev, kick));
      later(300);
    };
    ['pointerdown', 'scroll', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, kick, { passive: true, once: true }));
    setTimeout(kick, 6000);
  };

  if (!motionAllowed()) emit({ state: 'static (motion off)' });
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });

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
