import { describe, expect, it } from 'vitest';
import profile from '../../src/data/profile.json';
import projects from '../../src/data/projects.json';
import { run, complete, findProject, tokenize, type Ctx } from '../../src/scripts/terminal/commands';
import { localAnswer } from '../../src/scripts/terminal/answer';

const ctx = (): Ctx & { projects: typeof projects } => ({ profile, projects, history: [] });
const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.text).join('\n');

describe('terminal commands', () => {
  it('tokenizes and ignores empty input', () => {
    expect(tokenize('  ls   projects ')).toEqual(['ls', 'projects']);
    expect(run('   ', ctx()).lines).toEqual([]);
  });
  it('help lists every command', () => {
    const out = text(run('help', ctx()));
    for (const c of ['whoami', 'ls', 'cat', 'open', 'ask', 'contact', 'theme', 'motion', 'clear']) expect(out).toContain(c);
  });
  it('whoami shows the real CGPA, never the stale one', () => {
    const out = text(run('whoami', ctx()));
    expect(out).toContain('8.04');
    expect(out).not.toContain('8.23');
  });
  it('ls projects lists all five with links', () => {
    const r = run('ls projects', ctx());
    expect(r.lines).toHaveLength(5);
    expect(r.lines.every((l) => l.href?.startsWith('/projects/'))).toBe(true);
  });
  it('cat finds projects by partial name', () => {
    expect(text(run('cat messy', ctx()))).toContain('0.954');
    expect(findProject(ctx(), 'medsync')?.slug).toBe('medsyncpro');
    expect(run('cat nope', ctx()).lines[0]?.kind).toBe('error');
  });
  it('open returns an open action', () => {
    expect(run('open resume', ctx()).action).toEqual({ type: 'open', href: '/resume/' });
    expect(run('open llm-code', ctx()).action).toEqual({ type: 'open', href: '/projects/llm-code-deployment-agent/' });
  });
  it('ask validates length and returns an ask action', () => {
    expect(run('ask', ctx()).action).toBeUndefined();
    expect(run(`ask ${'x'.repeat(301)}`, ctx()).lines[0]?.kind).toBe('error');
    expect(run('ask what is your cgpa', ctx()).action).toEqual({ type: 'ask', question: 'what is your cgpa' });
  });
  it('theme and motion toggles', () => {
    expect(run('theme plain', ctx()).action).toEqual({ type: 'glow', on: false });
    expect(run('theme glow', ctx()).action).toEqual({ type: 'glow', on: true });
    expect(run('motion pause', ctx()).action).toEqual({ type: 'motion', paused: true });
    expect(run('motion resume', ctx()).action).toEqual({ type: 'motion', paused: false });
  });
  it('easter eggs and unknown commands', () => {
    expect(text(run('sudo hire kartik', ctx()))).toContain(profile.email);
    expect(run('sudo rm -rf /', ctx()).lines[0]?.kind).toBe('error');
    expect(text(run('foo', ctx()))).toContain('command not found');
  });
  it('tab completion', () => {
    expect(complete('wh', ctx())).toBe('whoami ');
    expect(complete('cat mes', ctx())).toBe('cat messy-mashup ');
    expect(complete('c', ctx())).toBeNull();
  });
});

describe('offline answers use only site facts', () => {
  it('answers education with the real CGPA', () => {
    expect(localAnswer('what is your cgpa?', ctx())).toContain('8.04');
  });
  it('answers about a named project with its demo link', () => {
    const a = localAnswer('tell me about the deployment agent', ctx());
    expect(a).toContain('LLM Code Deployment Agent');
    expect(a).toContain('huggingface.co');
  });
  it('declines unrelated questions', () => {
    expect(localAnswer('what is the capital of France', ctx())).toContain('only answer');
  });
});
