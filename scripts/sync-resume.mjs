// Copies the final resume Markdown from the career folder (local machine only).
import { copyFile, access } from 'node:fs/promises';
const SRC = 'G:/internship/career_audit_2026-11-08/Kartik_Bajaj_-_Resume_AI_LLM.md';
try {
  await access(SRC);
  await copyFile(SRC, new URL('../resume/resume.md', import.meta.url));
  console.log('[sync-resume] copied', SRC);
} catch {
  console.log('[sync-resume] source not found, keeping resume/resume.md');
}
