// Fetches public, non-fork repos for GITHUB_USER at build time and writes src/data/github.json.
// Adapted from kbxai/My-portfolio-terminal/scripts/fetch-github.mjs. Zero dependencies (Node 18+ fetch).
// Never fails the build: on API errors it keeps the previous file or writes an empty list.
import { readFile, writeFile, access } from 'node:fs/promises';

const OUT = new URL('../src/data/github.json', import.meta.url);
const OVERRIDES = new URL('./overrides.json', import.meta.url);
const USER = process.env.GITHUB_USER || 'kbxai';
const TOKEN = process.env.GITHUB_TOKEN || '';

const exists = (u) => access(u).then(() => true, () => false);

async function fetchRepos() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kbxai-portfolio-build' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const repos = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/users/${USER}/repos?per_page=100&type=owner&sort=updated&page=${page}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

const o = JSON.parse(await readFile(OVERRIDES, 'utf8'));
const hidden = new Set(o.hidden ?? []);
const featured = new Set(o.featured ?? []);

let repos;
try {
  repos = await fetchRepos();
} catch (err) {
  if (await exists(OUT)) {
    console.warn(`[fetch-github] ${err.message}; keeping existing github.json`);
    process.exit(0);
  }
  console.warn(`[fetch-github] ${err.message}; writing empty list`);
  repos = [];
}

const list = repos
  .filter((r) => !r.fork && !r.private && !hidden.has(r.name))
  .map((r) => ({
    name: r.name,
    description: r.description ?? null,
    url: r.html_url,
    homepage: r.homepage || null,
    language: r.language ?? null,
    topics: r.topics ?? [],
    stars: r.stargazers_count ?? 0,
    updatedAt: r.pushed_at ?? r.updated_at,
    featured: featured.has(r.name),
  }))
  .sort((a, b) => Number(b.featured) - Number(a.featured) || b.updatedAt.localeCompare(a.updatedAt));

await writeFile(OUT, JSON.stringify({ user: USER, fetchedAt: new Date().toISOString(), repos: list }, null, 2) + '\n');
console.log(`[fetch-github] wrote ${list.length} repos for ${USER}`);
