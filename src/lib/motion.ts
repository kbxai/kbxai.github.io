// Global motion state: respects prefers-reduced-motion and a user pause toggle (WCAG 2.2.2).
const KEY = 'kb.motion';
const root = document.documentElement;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPaused(): boolean {
  return root.dataset.motion === 'paused';
}

export function motionAllowed(): boolean {
  return !reducedMotion() && !isPaused();
}

export function setPaused(paused: boolean): void {
  if (paused) root.dataset.motion = 'paused';
  else delete root.dataset.motion;
  try {
    if (paused) localStorage.setItem(KEY, 'paused');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: state lasts for this page view only */
  }
  window.dispatchEvent(new CustomEvent('kb:motion', { detail: { paused } }));
  syncButton();
}

function syncButton(): void {
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;
  const paused = isPaused();
  btn.setAttribute('aria-pressed', String(paused));
  const label = btn.querySelector('.txt');
  if (label) label.textContent = paused ? 'Motion off' : 'Motion on';
}

export function initMotionToggle(): void {
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;
  btn.style.visibility = 'visible';
  syncButton();
  btn.addEventListener('click', () => setPaused(!isPaused()));
}

export function setGlow(on: boolean): void {
  if (on) delete root.dataset.glow;
  else root.dataset.glow = 'off';
  try {
    if (on) localStorage.removeItem('kb.glow');
    else localStorage.setItem('kb.glow', 'off');
  } catch {
    /* ignore */
  }
}
