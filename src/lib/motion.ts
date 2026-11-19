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

// The header button is named "Motion" and reads "Motion on" / "Motion off"; aria-pressed = motion on. Its space is reserved but it stays invisible until JS runs (no layout shift; without JS nothing moves).
function syncButton(): void {
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;
  const paused = isPaused();
  btn.setAttribute('aria-pressed', String(!paused));
  const state = btn.querySelector('.state');
  if (state) state.textContent = paused ? 'off' : 'on';
}

export function initMotionToggle(): void {
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;
  btn.removeAttribute('data-pending');
  syncButton();
  btn.addEventListener('click', () => setPaused(!isPaused()));
}
