import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';
import { isPaused, reducedMotion } from './motion';

const set = (k: string, v: string) => {
  const el = document.querySelector<HTMLElement>(`[data-hud="${k}"]`);
  if (el) el.textContent = v;
};

function jsKB(): number {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const bytes = entries
    .filter((e) => e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name))
    .reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0);
  return Math.round(bytes / 1024);
}

export function startHud(): void {
  const fmt = (m: Metric) => (m.name === 'CLS' ? m.value.toFixed(3) : `${Math.round(m.value)} ms`);
  onLCP((m) => set('lcp', fmt(m)), { reportAllChanges: true });
  onCLS((m) => set('cls', fmt(m)), { reportAllChanges: true });
  onINP((m) => set('inp', fmt(m)), { reportAllChanges: true });
  const motion = () => set('motion', reducedMotion() ? 'reduced (OS)' : isPaused() ? 'paused' : 'on');
  motion();
  window.addEventListener('kb:motion', motion);
  const js = () => set('js', `${jsKB()} KB`);
  js();
  new PerformanceObserver(js).observe({ type: 'resource', buffered: false });
  type HeroState = { tier?: string; frameMs?: number; state?: string };
  const apply = (d: HeroState) => {
    if (d.tier) set('gpu', d.tier);
    if (d.state) set('gpu', d.state);
    if (typeof d.frameMs === 'number') set('frame', `${d.frameMs.toFixed(1)} ms`);
  };
  const early = (window as Window & { kbHeroState?: HeroState }).kbHeroState;
  if (early) apply(early);
  window.addEventListener('kb:hero', ((e: CustomEvent<HeroState>) => apply(e.detail)) as EventListener);
}
