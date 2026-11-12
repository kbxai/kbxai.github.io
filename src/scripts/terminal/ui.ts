import profile from '../../data/profile.json';
import projects from '../../data/projects.json';
import { run, complete, type Ctx, type Line } from './commands';
import { localAnswer, type KnowledgeProject } from './answer';
import { motionAllowed, setGlow, setPaused } from '../../lib/motion';

export const ASK_ENDPOINT = 'https://24f2007692-ask-kartik.hf.space/ask';
const GLYPHS = '.:-=+*#%@01<>/\\|';

const ctx: Ctx & { projects: KnowledgeProject[] } = { profile, projects, history: [] };

function lineEl(line: Line): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = `k-${line.kind ?? 'plain'}`;
  if (line.href) {
    const a = document.createElement('a');
    a.href = line.href;
    a.textContent = line.text;
    p.append(a);
  } else {
    p.textContent = line.text;
  }
  return p;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Glyph-rain: random glyphs settle into the final text. Instant when motion is off. */
async function settle(el: HTMLElement, text: string): Promise<void> {
  if (!motionAllowed() || text.length > 900) {
    el.textContent = text;
    return;
  }
  const frames = 18;
  for (let f = 1; f <= frames; f++) {
    const fixed = Math.floor((text.length * f) / frames);
    let s = text.slice(0, fixed);
    for (let i = fixed; i < Math.min(text.length, fixed + 24); i++) s += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = s;
    await wait(28);
  }
  el.textContent = text;
}

async function askRemote(question: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(ASK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string };
    return typeof data.answer === 'string' && data.answer.trim() ? data.answer.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function initTerminal(): void {
  const root = document.getElementById('term');
  const log = document.getElementById('term-log');
  const form = document.getElementById('term-form') as HTMLFormElement | null;
  const input = document.getElementById('term-input') as HTMLInputElement | null;
  if (!root || !log || !form || !input) return;
  root.hidden = false;
  let cursor = -1;

  const print = (lines: Line[]) => {
    for (const l of lines) log.append(lineEl(l));
    log.scrollTop = log.scrollHeight;
  };

  const boot = async () => {
    let first = true;
    try {
      first = !sessionStorage.getItem('kb.booted');
      sessionStorage.setItem('kb.booted', '1');
    } catch {
      /* ignore */
    }
    const lines: Line[] = first
      ? [
          { text: 'kbxai-os v2026.11 (tty1)', kind: 'muted' },
          { text: '[ ok ] mounted /projects (5 entries, facts checked against resume)', kind: 'muted' },
          { text: '[ ok ] ascii renderer ready (WebGL2, static fallback)', kind: 'muted' },
        ]
      : [];
    lines.push({ text: "Type 'help' to see commands, or try: ls projects, cat messy-mashup, ask what is your best project?", kind: 'plain' });
    for (const l of lines) {
      print([l]);
      if (first && motionAllowed()) await wait(220);
    }
  };

  const handleAsk = async (question: string) => {
    const status = lineEl({ text: 'thinking... (an AI grounded only on this site\'s facts)', kind: 'muted' });
    log.append(status);
    const remote = await askRemote(question);
    status.textContent = remote ? '[gemini, grounded on site facts]' : '[offline answer from site facts: the AI backend is asleep or unavailable]';
    const out = document.createElement('p');
    log.append(out);
    log.scrollTop = log.scrollHeight;
    await settle(out, remote ?? localAnswer(question, ctx));
    log.scrollTop = log.scrollHeight;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value;
    input.value = '';
    cursor = -1;
    print([{ text: `visitor@kbxai:~$ ${value}`, kind: 'muted' }]);
    if (value.trim()) ctx.history.push(value.trim());
    const res = run(value, ctx);
    print(res.lines);
    const a = res.action;
    if (!a) return;
    if (a.type === 'clear') log.replaceChildren();
    else if (a.type === 'open') window.location.href = a.href;
    else if (a.type === 'glow') setGlow(a.on);
    else if (a.type === 'motion') setPaused(a.paused);
    else if (a.type === 'ask') await handleAsk(a.question);
    else if (a.type === 'experimental') {
      const desktop = window.matchMedia('(pointer: fine) and (min-width: 900px)').matches;
      if (!desktop || !motionAllowed()) {
        print([{ text: 'experimental extras need a desktop browser with motion enabled.', kind: 'error' }]);
        return;
      }
      const mod = a.name === 'fluid' ? await import('../../three/fluid') : await import('../../three/crt');
      mod.start();
    }
  });

  input.addEventListener('keydown', (e) => {
    const h = ctx.history;
    if (e.key === 'ArrowUp' && h.length) {
      e.preventDefault();
      cursor = cursor < 0 ? h.length - 1 : Math.max(0, cursor - 1);
      input.value = h[cursor] ?? '';
    } else if (e.key === 'ArrowDown' && h.length) {
      e.preventDefault();
      cursor = cursor < 0 ? -1 : cursor + 1;
      if (cursor >= h.length) cursor = -1;
      input.value = cursor < 0 ? '' : h[cursor] ?? '';
    } else if (e.key === 'Tab' && input.value.trim()) {
      const c = complete(input.value, ctx);
      if (c) {
        e.preventDefault();
        input.value = c;
      }
    } else if (e.key === 'Escape') {
      input.value = '';
    }
  });

  void boot();
}
