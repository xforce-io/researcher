import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { loadProjectYaml } from '../config/project-yaml.js';
import { loadThesis } from '../config/thesis-md.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 10 * 60 * 1000;

export async function soulBootstrap(ctx: RunContext): Promise<void> {
  const userPrompt = renderTemplate(loadPromptTemplate('stage-soul-bootstrap.md'), {
    project_yaml: readFileSync(join(ctx.researcherDir, 'project.yaml'), 'utf8'),
    thesis: ctx.thesis.body,
    readme: readIfExists(join(ctx.projectRoot, 'README.md')) ?? '(no README.md at repo root)',
    notes_listing: listNotes(join(ctx.projectRoot, 'notes')),
    papers_readme: readIfExists(join(ctx.projectRoot, 'papers/README.md')) ?? '(no papers/README.md)',
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode !== 0) throw new Error(`soul_bootstrap stage agent exited ${result.exitCode}`);

  if (existsSync(join(ctx.researcherDir, 'open_questions.md'))) {
    ctx.needsHumanInput = true;
    return;
  }

  // Re-load yaml + thesis from disk so downstream stages see drafted content.
  ctx.projectYaml = loadProjectYaml(join(ctx.researcherDir, 'project.yaml'));
  ctx.thesis = loadThesis(join(ctx.researcherDir, 'thesis.md'));
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function listNotes(notesDir: string): string {
  if (!existsSync(notesDir)) return '(no notes/ directory)';
  const entries = readdirSync(notesDir).filter((f) => f.endsWith('.md')).sort();
  return entries.length > 0 ? entries.join('\n') : '(notes/ exists but is empty)';
}
