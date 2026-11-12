// Decode effect: text resolves from random glyphs. Real text is restored immediately for assistive tech
// (aria-label) and the effect is skipped entirely when motion is reduced or paused.
import { motionAllowed } from './motion';

const GLYPHS = '!<>-_\/[]{}=+*^?#%@01';

export function scramble(el: HTMLElement, duration = 700): void {
  const final = el.textContent ?? '';
  if (!final.trim() || !motionAllowed()) return;
  el.setAttribute('aria-label', final);
  const start = performance.now();
  const order = [...final].map(() => Math.random());
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    let out = '';
    for (let i = 0; i < final.length; i++) {
      const ch = final[i]!;
      out += ch === ' ' || order[i]! < t ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = final;
  };
  requestAnimationFrame(tick);
}

export function scrambleAll(selector = '[data-scramble]'): void {
  const els = [...document.querySelectorAll<HTMLElement>(selector)];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      scramble(e.target as HTMLElement, Number((e.target as HTMLElement).dataset.scramble) || 700);
    }
  });
  els.forEach((el) => io.observe(el));
}
