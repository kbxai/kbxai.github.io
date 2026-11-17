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

const STORE = 'kb.term';
const MAX_SAVED = 60_000;

/** Is the user typing somewhere else (so "/" must not steal the key)? */
function typingElsewhere(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function initTerminal(): void {
  const root = document.getElementById('term');
  const log = document.getElementById('term-log');
  const form = document.getElementById('term-form') as HTMLFormElement | null;
  const input = document.getElementById('term-input') as HTMLInputElement | null;
  const dialog = document.getElementById('term-dialog') as HTMLDialogElement | null;
  const launch = document.getElementById('term-launch') as HTMLButtonElement | null;
  if (!root || !log || !form || !input || !dialog) return;
  root.hidden = false;
  if (launch) launch.hidden = false;
  document.querySelectorAll<HTMLElement>('[data-term-ui]').forEach((el) => (el.hidden = false));
  let cursor = -1;
  let booted = false;
  let booting: Promise<void> = Promise.resolve();
  let hurry = false;

  // the conversation follows the visitor from page to page (this tab only)
  const save = () => {
    try {
      while (log.innerHTML.length > MAX_SAVED && log.firstChild) log.firstChild.remove();
      sessionStorage.setItem(STORE, JSON.stringify({ html: log.innerHTML, history: ctx.history.slice(-50) }));
    } catch {
      /* storage blocked or full: the session still works, it just is not kept */
    }
  };
  const restore = (): boolean => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as { html?: string; history?: string[] } | null;
      if (!saved?.html) return false;
      log.innerHTML = saved.html;
      ctx.history.push(...(saved.history ?? []));
      return true;
    } catch {
      return false;
    }
  };

  const print = (lines: Line[]) => {
    for (const l of lines) log.append(lineEl(l));
    log.scrollTop = log.scrollHeight;
  };

  const open = () => {
    if (!dialog.open) dialog.showModal();
    if (!booted) {
      booted = true;
      if (restore()) log.scrollTop = log.scrollHeight;
      else booting = boot();
    }
    requestAnimationFrame(() => input.focus());
  };
  const close = () => dialog.open && dialog.close();
  const runCommand = (cmd: string) => {
    open();
    input.value = cmd;
    form.requestSubmit();
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
      if (first && motionAllowed() && !hurry) await wait(220);
    }
    save();
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
    save();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value;
    input.value = '';
    // a command typed while the boot lines print: finish them at once, then answer below them
    hurry = true;
    await booting;
    cursor = -1;
    print([{ text: `visitor@kbxai:~$ ${value}`, kind: 'muted' }]);
    if (value.trim()) ctx.history.push(value.trim());
    const res = run(value, ctx);
    print(res.lines);
    const a = res.action;
    save();
    if (!a) return;
    if (a.type === 'clear') {
      log.replaceChildren();
      save();
    } else if (a.type === 'open') {
      if (a.newTab) {
        // within the Enter key's user activation window, so this is not treated as a popup
        // ('noopener' would make window.open return null even on success, so cut the opener by hand)
        const w = window.open(a.href, '_blank');
        if (w) w.opener = null;
        else window.location.href = a.href;
      } else {
        close();
        window.location.href = a.href;
      }
    }
    else if (a.type === 'glow') setGlow(a.on);
    else if (a.type === 'motion') setPaused(a.paused);
    else if (a.type === 'ask') await handleAsk(a.question);
    else if (a.type === 'face') {
      const { default: face } = await import('../../data/portrait-ascii.txt?raw');
      const pre = document.createElement('pre');
      pre.className = 'face';
      pre.setAttribute('aria-label', 'ASCII portrait of Kartik Bajaj');
      pre.textContent = face;
      log.append(pre);
      log.scrollTop = log.scrollHeight;
      save();
    }
    else if (a.type === 'experimental') {
      const desktop = window.matchMedia('(pointer: fine) and (min-width: 900px)').matches;
      if (!desktop || !motionAllowed()) {
        print([{ text: 'experimental extras need a desktop browser with motion enabled.', kind: 'error' }]);
        return;
      }
      const mod = a.name === 'fluid' ? await import('../../three/fluid') : await import('../../three/crt');
      close();
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
    } else if (e.key === 'Escape' && input.value) {
      // first Escape clears the line, the next one closes the dialog
      e.preventDefault();
      input.value = '';
    }
  });

  launch?.addEventListener('click', open);
  document.getElementById('term-close')?.addEventListener('click', close);
  // click on the dimmed backdrop (outside the panel) closes it
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  // any element on any page can open the terminal or run a command in it
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-term-cmd], [data-term-open]');
    if (!el) return;
    e.preventDefault();
    const cmd = el.dataset.termCmd;
    if (cmd) runCommand(cmd);
    else open();
  });
  // "/" or Ctrl/Cmd+K from anywhere on the site
  document.addEventListener('keydown', (e) => {
    if (dialog.open) return;
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingElsewhere(e.target);
    const cmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    if (slash || cmdK) {
      e.preventDefault();
      open();
    }
  });
  if (location.hash === '#ask') open();
}
