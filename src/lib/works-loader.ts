// Starts the 3D project figures once the Work section comes near the screen. The three.js chunk loads only then.
// Motion off (reduced motion or the header toggle): the figures render once, settled, and never move.
// No WebGL2 or Save-Data: the plain figures (screenshot, chart, flow) stay.
import { motionAllowed } from './motion';
import { detectTier } from './hero-loader';

export function maybeStartWorks(): void {
  const hosts = [...document.querySelectorAll<HTMLElement>('[data-w3d]')];
  if (!hosts.length) return;
  let stop: (() => void) | null = null;
  let starting = false;

  const start = async () => {
    if (stop || starting) return;
    if (detectTier(true) === 'none') return;
    starting = true;
    try {
      const { startWorks } = await import('../three/works/engine');
      stop = await startWorks(hosts, { still: !motionAllowed() });
    } catch (err) {
      console.warn('[works] disabled:', err);
    } finally {
      starting = false;
    }
  };

  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      void start();
    }
  }, { rootMargin: '80% 0px' });
  const go = () => hosts.forEach((h) => io.observe(h));
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });

  window.addEventListener('pageshow', (e) => { if (e.persisted) { stop = null; void start(); } });
  // the header toggle: restart in the other mode (still <-> moving)
  window.addEventListener('kb:motion', () => {
    stop?.();
    stop = null;
    void start();
  });
}
