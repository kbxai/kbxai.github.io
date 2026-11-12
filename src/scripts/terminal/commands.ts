// Pure command interpreter for the portfolio terminal. No DOM access, so it is unit-tested.

export type Kind = 'muted' | 'accent' | 'amber' | 'error' | 'plain';
export interface Line { text: string; href?: string; kind?: Kind }
export type Action =
  | { type: 'clear' }
  | { type: 'open'; href: string }
  | { type: 'glow'; on: boolean }
  | { type: 'motion'; paused: boolean }
  | { type: 'ask'; question: string }
  | { type: 'experimental'; name: string }
  | { type: 'face' };
export interface Result { lines: Line[]; action?: Action }

export interface ProjectLite {
  slug: string; title: string; context: string; dates: string; summary: string;
  metric: { label: string; value: string }; stack: string[]; links: { demo?: string; github: string };
}
export interface Ctx {
  profile: {
    name: string; headline: string; email: string; phone: string; location: string; availability: string;
    links: { github: string; linkedin: string };
    education: { institution: string; degree: string; dates: string; detail: string }[];
    skills: { group: string; items: string[] }[];
  };
  projects: ProjectLite[];
  history: string[];
}

export const COMMANDS: { name: string; usage: string; about: string }[] = [
  { name: 'help', usage: 'help', about: 'list commands' },
  { name: 'whoami', usage: 'whoami [--face]', about: 'who I am (--face prints my ASCII portrait)' },
  { name: 'ls', usage: 'ls [projects|lab]', about: 'list projects or lab pages' },
  { name: 'cat', usage: 'cat <project|skills|education>', about: 'print details' },
  { name: 'open', usage: 'open <project|resume|github|linkedin|lab>', about: 'open a page' },
  { name: 'ask', usage: 'ask <question>', about: 'ask an AI grounded only on this site' },
  { name: 'contact', usage: 'contact', about: 'email, phone, links' },
  { name: 'theme', usage: 'theme [glow|plain]', about: 'toggle the glow and scanlines' },
  { name: 'motion', usage: 'motion [pause|resume]', about: 'pause or resume all animation' },
  { name: 'history', usage: 'history', about: 'commands you typed' },
  { name: 'clear', usage: 'clear', about: 'clear the screen' },
  { name: 'experimental', usage: 'experimental [fluid|crt]', about: 'desktop-only extras' },
];

const L = (text: string, kind: Kind = 'plain', href?: string): Line => ({ text, kind, href });

export function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

export function findProject(ctx: Ctx, query: string): ProjectLite | undefined {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q) return undefined;
  return (
    ctx.projects.find((p) => p.slug.replace(/[^a-z0-9]/g, '') === q) ??
    ctx.projects.find((p) => p.slug.replace(/[^a-z0-9]/g, '').startsWith(q)) ??
    ctx.projects.find((p) => p.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))
  );
}

function projectLines(p: ProjectLite): Line[] {
  const lines = [
    L(p.title, 'accent'),
    L(`${p.context} | ${p.dates}`, 'muted'),
    L(p.metric.label === 'live' ? `[live] ${p.metric.value}` : `${p.metric.label} ${p.metric.value}`, 'amber'),
    L(p.summary),
    L(`stack: ${p.stack.join(', ')}`, 'muted'),
  ];
  if (p.links.demo) lines.push(L(`live demo: ${p.links.demo}`, 'plain', p.links.demo));
  lines.push(L(`github: ${p.links.github}`, 'plain', p.links.github));
  lines.push(L(`man page: /projects/${p.slug}/`, 'plain', `/projects/${p.slug}/`));
  return lines;
}

export function run(input: string, ctx: Ctx): Result {
  const [rawCmd, ...args] = tokenize(input);
  if (!rawCmd) return { lines: [] };
  const cmd = rawCmd.toLowerCase();
  const arg = args.join(' ');

  switch (cmd) {
    case 'help':
    case '?':
      return {
        lines: [
          L('available commands:', 'muted'),
          ...COMMANDS.map((c) => L(`  ${c.usage.padEnd(42)} ${c.about}`)),
          L('tip: Up/Down for history, Tab completes, Esc clears the input.', 'muted'),
        ],
      };
    case 'whoami':
      if (args[0] === '--face' || args[0] === '-f') return { lines: [L('rendering face from 478 landmarks...', 'muted')], action: { type: 'face' } };
      return {
        lines: [
          L(ctx.profile.name, 'accent'),
          L(ctx.profile.headline),
          L(ctx.profile.education[0] ? `${ctx.profile.education[0].institution}, ${ctx.profile.education[0].degree}` : '', 'muted'),
          L(ctx.profile.education[0]?.detail ?? '', 'amber'),
          L(ctx.profile.availability, 'muted'),
        ].filter((l) => l.text),
      };
    case 'ls': {
      const what = (args[0] ?? 'projects').toLowerCase();
      if (what === 'lab') return { lines: [L('spectrogram/  live audio -> glowing log-mel waterfall', 'plain', '/lab/spectrogram/')] };
      if (what !== 'projects' && what !== '.' && what !== './projects') return { lines: [L(`ls: cannot access '${args[0]}': try 'ls projects' or 'ls lab'`, 'error')] };
      return { lines: ctx.projects.map((p) => L(`${p.slug.padEnd(30)} ${p.metric.label === 'live' ? '[live]' : `${p.metric.label} ${p.metric.value}`}`, 'plain', `/projects/${p.slug}/`)) };
    }
    case 'cat': {
      if (!arg) return { lines: [L('cat: missing operand (try: cat messy-mashup)', 'error')] };
      const a = arg.toLowerCase();
      if (a.startsWith('skill')) return { lines: ctx.profile.skills.map((s) => L(`${s.group}: ${s.items.join(', ')}`)) };
      if (a.startsWith('edu')) return { lines: ctx.profile.education.flatMap((e) => [L(e.institution, 'accent'), L(`${e.degree} | ${e.dates}`, 'muted'), L(e.detail, 'amber')]) };
      const p = findProject(ctx, arg);
      return p ? { lines: projectLines(p) } : { lines: [L(`cat: ${arg}: no such project (try 'ls projects')`, 'error')] };
    }
    case 'open': {
      const a = arg.toLowerCase();
      const fixed: Record<string, string> = {
        resume: '/resume/', cv: '/resume/', github: ctx.profile.links.github, linkedin: ctx.profile.links.linkedin, lab: '/lab/spectrogram/',
      };
      if (fixed[a]) return { lines: [L(`opening ${fixed[a]}`, 'muted')], action: { type: 'open', href: fixed[a] } };
      const p = findProject(ctx, arg);
      if (p) return { lines: [L(`opening /projects/${p.slug}/`, 'muted')], action: { type: 'open', href: `/projects/${p.slug}/` } };
      return { lines: [L(`open: ${arg || '(nothing)'}: not found`, 'error')] };
    }
    case 'contact':
      return {
        lines: [
          L(`email     ${ctx.profile.email}`, 'plain', `mailto:${ctx.profile.email}`),
          L(`phone     ${ctx.profile.phone}`),
          L(`github    ${ctx.profile.links.github}`, 'plain', ctx.profile.links.github),
          L(`linkedin  ${ctx.profile.links.linkedin}`, 'plain', ctx.profile.links.linkedin),
          L(`location  ${ctx.profile.location}`, 'muted'),
        ],
      };
    case 'ask':
      if (!arg) return { lines: [L('usage: ask <question>   e.g. ask what did you build with Gemini?', 'muted')] };
      if (arg.length > 300) return { lines: [L('ask: question too long (max 300 characters)', 'error')] };
      return { lines: [], action: { type: 'ask', question: arg } };
    case 'theme': {
      const on = !['plain', 'off', 'noglow'].includes((args[0] ?? '').toLowerCase());
      return { lines: [L(on ? 'glow on' : 'glow off (plain text, no scanlines)', 'muted')], action: { type: 'glow', on } };
    }
    case 'motion': {
      const paused = !['resume', 'on', 'play'].includes((args[0] ?? 'pause').toLowerCase());
      return { lines: [L(paused ? 'motion paused' : 'motion resumed', 'muted')], action: { type: 'motion', paused } };
    }
    case 'history':
      return { lines: ctx.history.map((h, i) => L(`${String(i + 1).padStart(4)}  ${h}`, 'muted')) };
    case 'clear':
    case 'cls':
      return { lines: [], action: { type: 'clear' } };
    case 'experimental': {
      const name = (args[0] ?? '').toLowerCase();
      if (name !== 'fluid' && name !== 'crt') return { lines: [L('usage: experimental fluid | experimental crt   (desktop only)', 'muted')] };
      return { lines: [L(`starting ${name}... (type 'motion pause' to stop)`, 'muted')], action: { type: 'experimental', name } };
    }
    case 'sudo':
      if (arg.toLowerCase().replace(/\s+/g, ' ') === 'hire kartik') {
        return {
          lines: [
            L('[sudo] password for recruiter: ********', 'muted'),
            L('access granted.', 'accent'),
            L(`${ctx.profile.name} | ${ctx.profile.headline}`, 'amber'),
            L(`email ${ctx.profile.email} | phone ${ctx.profile.phone}`, 'plain', `mailto:${ctx.profile.email}`),
            L('resume: /resume/', 'plain', '/resume/'),
          ],
        };
      }
      return { lines: [L('visitor is not in the sudoers file. This incident will be reported. (try: sudo hire kartik)', 'error')] };
    case 'neofetch':
      return {
        lines: [
          L('visitor@kbxai', 'accent'),
          L('-------------', 'muted'),
          L(`name: ${ctx.profile.name}`),
          L('os: IIT Madras BS Data Science'),
          L(`shell: ${ctx.profile.headline}`),
          L(`projects: ${ctx.projects.length}`),
          L('stack: Astro, three.js (WebGL2), vanilla TypeScript'),
        ],
      };
    case 'exit':
      return { lines: [L('logout. (you can still scroll; this is a website)', 'muted')] };
    case 'rm':
      return { lines: [L('rm: permission denied. Nice try.', 'error')] };
    default:
      return { lines: [L(`bash: ${rawCmd}: command not found. Type 'help'.`, 'error')] };
  }
}

export function complete(partial: string, ctx: Ctx): string | null {
  const parts = partial.split(/\s+/);
  if (parts.length <= 1) {
    const hit = COMMANDS.map((c) => c.name).filter((n) => n.startsWith(parts[0] ?? ''));
    return hit.length === 1 ? `${hit[0]} ` : null;
  }
  const last = (parts.at(-1) ?? '').toLowerCase();
  const pool = [...ctx.projects.map((p) => p.slug), 'resume', 'github', 'linkedin', 'lab', 'skills', 'education', 'projects'];
  const hit = pool.filter((s) => s.startsWith(last));
  return hit.length === 1 ? [...parts.slice(0, -1), hit[0]].join(' ') + ' ' : null;
}
