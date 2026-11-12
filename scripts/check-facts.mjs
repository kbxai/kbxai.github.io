// Build gate: every number and title on the site must exist in the resume, and stale facts must be gone.
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const resume = (await read('resume/resume.md')).replaceAll('\\~', '~');
const profile = JSON.parse(await read('src/data/profile.json'));
const projects = JSON.parse(await read('src/data/projects.json'));
const siteText = JSON.stringify({ profile, projects });

const errors = [];

const BANNED = ['8.23', 'SmartParkr', 'Kaggle F1', 'Full-Stack Engineer', 'FastAPI & Celery', '24F2007692/vehicle'];
for (const b of BANNED) if (siteText.includes(b)) errors.push(`stale/banned text found: "${b}"`);

const REQUIRED = ['8.04', '0.954', '0.8295', '0.7386', '0.7460', '~0.92', '~0.96', '9.0/10', 'Jun 2028', 'Jul 2027'];
for (const r of REQUIRED) {
  if (!resume.includes(r)) errors.push(`required fact "${r}" missing from resume/resume.md`);
  if (!siteText.includes(r)) errors.push(`required fact "${r}" missing from site data`);
}

const numbers = new Set(siteText.match(/\b\d+\.\d{2,4}\b/g) ?? []);
for (const n of numbers) if (!resume.includes(n)) errors.push(`number ${n} on the site is not in the resume`);

for (const p of projects) {
  if (!resume.includes(p.title)) errors.push(`project title not in resume: ${p.title}`);
  if (!resume.includes(p.dates)) errors.push(`dates for ${p.title} not in resume: ${p.dates}`);
  for (const b of p.bullets) if (!resume.includes(b)) errors.push(`bullet for ${p.title} differs from resume: "${b.slice(0, 60)}..."`);
  for (const url of Object.values(p.links)) if (!resume.includes(url.replace(/^https:\/\/(www\.)?/, ''))) errors.push(`link not in resume: ${url}`);
}
for (const k of ['email', 'phone', 'location', 'headline', 'availability']) if (!resume.includes(profile[k])) errors.push(`profile.${k} differs from resume`);
for (const e of profile.education) if (!resume.includes(e.detail)) errors.push(`education detail differs: ${e.detail}`);

if (errors.length) {
  console.error(`[check-facts] ${errors.length} problem(s):\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log(`[check-facts] OK: ${projects.length} projects, ${numbers.size} numbers verified against resume/resume.md`);
