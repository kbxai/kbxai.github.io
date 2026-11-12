// Offline fallback for `ask`: keyword answers built only from the site's own facts (public/knowledge.json).
import type { Ctx } from './commands';

export interface KnowledgeProject {
  slug: string; title: string; context: string; dates: string; summary: string; stack: string[];
  metric: { label: string; value: string }; limitations: string[]; links: { demo?: string; github: string };
}

export function localAnswer(question: string, ctx: Ctx & { projects: KnowledgeProject[] }): string {
  const q = question.toLowerCase();
  const p = ctx.profile;
  const has = (...w: string[]) => w.some((x) => q.includes(x));
  const proj = ctx.projects.find((x) => {
    const words = x.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => q.includes(w)) || q.includes(x.slug);
  });
  if (proj) {
    const demo = proj.links.demo ? ` Live demo: ${proj.links.demo}.` : '';
    const lim = proj.limitations[0] ? ` Known limitation: ${proj.limitations[0]}` : '';
    return `${proj.title} (${proj.context}, ${proj.dates}): ${proj.summary} Stack: ${proj.stack.join(', ')}.${demo}${lim}`;
  }
  if (has('cgpa', 'gpa', 'grade', 'college', 'university', 'iit', 'study', 'degree', 'graduat'))
    return p.education.map((e) => `${e.institution}, ${e.degree} (${e.dates}): ${e.detail}.`).join(' ');
  if (has('contact', 'email', 'phone', 'reach', 'hire', 'linkedin'))
    return `Email ${p.email}, phone ${p.phone}, LinkedIn ${p.links.linkedin}. ${p.availability}.`;
  if (has('skill', 'stack', 'know', 'tech', 'language', 'tools'))
    return p.skills.map((s) => `${s.group}: ${s.items.join(', ')}`).join('. ') + '.';
  if (has('available', 'availability', 'intern', 'when', 'remote', 'location', 'where'))
    return `${p.headline}. ${p.availability}. Based in ${p.location}.`;
  if (has('project', 'built', 'build', 'work', 'llm', 'gemini', 'ml', 'model'))
    return `Projects: ${ctx.projects.map((x) => `${x.title} (${x.metric.label === 'live' ? 'live demo' : `${x.metric.label} ${x.metric.value}`})`).join('; ')}. Try 'cat <project>' for details.`;
  return "I only answer from this site's facts: projects, skills, education, availability and contact. Try 'help' or 'ls projects'.";
}
