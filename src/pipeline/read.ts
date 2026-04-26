import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { fetchArxivMetadata } from '../sources/arxiv.js';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 15 * 60 * 1000;

export async function read(ctx: RunContext): Promise<void> {
  if (!ctx.addArxivId) throw new Error('read stage requires addArxivId in context');
  const meta = await fetchArxivMetadata(ctx.addArxivId);

  const paperText = await tryPdfToText(meta.pdf_url).catch(() => meta.abstract);

  const notesDir = join(ctx.projectRoot, 'notes');
  const existing = readdirSync(notesDir).filter((f) => /^\d+_.*\.md$/.test(f)).sort();
  // Pick max paper-note number + 1; skip 00_* (landscape index, not a paper).
  const maxNum = existing.reduce((m, f) => {
    if (f.startsWith('00_')) return m;
    const n = parseInt(f.match(/^(\d+)_/)?.[1] ?? '0', 10);
    return n > m ? n : m;
  }, 0);
  const nextNum = (maxNum + 1).toString().padStart(2, '0');
  const slug = slugify(meta.title);
  const nextFilename = `${nextNum}_${slug}.md`;

  const tpl = loadPromptTemplate('stage-read.md');
  const userPrompt = renderTemplate(tpl, {
    methodology_reading: ctx.methodology.get('01-reading.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    project_yaml: readFileSync(join(ctx.researcherDir, 'project.yaml'), 'utf8'),
    thesis: ctx.thesis.body,
    paper_metadata: JSON.stringify(meta, null, 2),
    paper_text: paperText.slice(0, 80_000),
    notes_dir_listing: existing.join('\n'),
    next_note_filename: nextFilename,
  });

  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode !== 0) throw new Error(`read stage agent exited ${result.exitCode}`);

  const fullPath = join(notesDir, nextFilename);
  ctx.newNoteFilename = nextFilename;
  ctx.newNoteContent = readFileSync(fullPath, 'utf8');
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_').slice(0, 6).join('_');
}

async function tryPdfToText(url: string): Promise<string> {
  // pull pdf to temp, run pdftotext
  const tmp = `/tmp/r-${Date.now()}.pdf`;
  await execa('curl', ['-sSL', '-o', tmp, url], { timeout: 60_000 });
  const { stdout } = await execa('pdftotext', [tmp, '-'], { timeout: 60_000 });
  return stdout;
}
