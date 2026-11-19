// Scroll reveals: section headings with [data-reveal] fade in once, the first time they enter view.
// Content is fully visible without JS: the hidden start state only applies under html.reveal-on, which this sets.
import { motionAllowed } from './motion';

export function initReveal(): void {
  const els = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (!els.length || !('IntersectionObserver' in window) || !motionAllowed()) return;
  const root = document.documentElement;
  // anything already on screen at load is shown at once (no flash, no layout shift)
  const vh = window.innerHeight;
  for (const el of els) if (el.getBoundingClientRect().top < vh * 0.92) el.classList.add('is-in');
  root.classList.add('reveal-on');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        const delay = Number(el.dataset.reveal) || 0;
        if (delay) el.style.transitionDelay = `${delay}ms`;
        el.classList.add('is-in');
        io.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  els.filter((el) => !el.classList.contains('is-in')).forEach((el) => io.observe(el));
  // if motion is paused later, show everything immediately
  window.addEventListener('kb:motion', () => els.forEach((el) => el.classList.add('is-in')));
}
