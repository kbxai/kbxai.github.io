// Builds public/knowledge.json: the only facts the ask-kartik terminal (and its backend) may use.
import { readFile, writeFile } from 'node:fs/promises';
const read = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8'));
const profile = await read('src/data/profile.json');
const projects = await read('src/data/projects.json');
const knowledge = {
  generatedAt: new Date().toISOString(),
  source: 'kbxai.github.io src/data (verified against resume by scripts/check-facts.mjs)',
  profile,
  projects: projects.map(({ slug, title, context, dates, stack, metric, summary, bullets, results, limitations, links }) => ({
    slug, title, context, dates, stack, metric, summary, bullets, results, limitations, links,
  })),
};
await writeFile(new URL('../public/knowledge.json', import.meta.url), JSON.stringify(knowledge) + '\n');
console.log(`[build-knowledge] wrote public/knowledge.json (${projects.length} projects)`);
