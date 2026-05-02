import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 45 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

export async function synthesize(ctx: RunContext): Promise<void> {
  if (!ctx.newNoteFilename || !ctx.newNoteContent) {
    throw new Error('synthesize requires newNoteFilename and newNoteContent in context');
  }
  const landscapePath = join(ctx.projectRoot, LANDSCAPE);
  if (!existsSync(landscapePath)) {
    mkdirSync(dirname(landscapePath), { recursive: true });
    writeFileSync(landscapePath, '# Research landscape\n\n_(empty — will be populated by researcher)_\n');
  }
  const landscapeBefore = readFileSync(landscapePath, 'utf8');

  const contradictionsPath = ctx.runDir.path('contradictions.md');
  ctx.contradictionsPath = contradictionsPath;

  const readmePath = join(ctx.projectRoot, 'README.md');
  const papersReadmePath = join(ctx.projectRoot, 'papers/README.md');
  const reportPath = join(ctx.projectRoot, 'report.md');
  const referencesDir = join(ctx.projectRoot, 'references');
  let referencesContext: string;
  if (existsSync(referencesDir)) {
    const refFiles = readdirSync(referencesDir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
      .sort();
    referencesContext = refFiles.length > 0
      ? `references/ contains ${refFiles.length} file(s): ${refFiles.join(', ')}\nRead the relevant ones before writing or updating report.md to ground synthesis in project-specific design context.`
      : '(references/ directory exists but contains no .md or .txt files)';
  } else {
    referencesContext = '(no references/ directory — skip this section)';
  }
  const userPrompt = renderTemplate(loadPromptTemplate('stage-synthesize.md'), {
    methodology_synthesis: ctx.methodology.get('04-synthesis.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    thesis: ctx.thesis.body,
    landscape_current: landscapeBefore,
    readme_current: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '(no README.md)',
    papers_readme_current: existsSync(papersReadmePath)
      ? readFileSync(papersReadmePath, 'utf8')
      : '(no papers/README.md — do not create one)',
    report_current: existsSync(reportPath)
      ? readFileSync(reportPath, 'utf8')
      : '(not yet created — create report.md from scratch using the structure in the instructions)',
    references_context: referencesContext,
    new_note_filename: ctx.newNoteFilename,
    new_note_content: ctx.newNoteContent,
    contradictions_path: contradictionsPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode !== 0) throw new Error(`synthesize stage agent exited ${result.exitCode}`);

  // capture diff
  try {
    const { stdout } = await execa('git', ['diff', '--', LANDSCAPE], { cwd: ctx.projectRoot });
    ctx.landscapeDiff = stdout;
  } catch {
    ctx.landscapeDiff = `(diff unavailable; landscape now reads:\n${readFileSync(landscapePath, 'utf8')})`;
  }
}
