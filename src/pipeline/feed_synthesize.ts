import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { digestId, digestSourceSlug } from '../sources/inbox.js';
import { listIntegratedNotes, nextNoteNumber } from '../state/note_index.js';
import { parseNote, serializeNote, DEFAULT_FM } from '../state/zone.js';
import type { RunContext } from './context.js';
import { assertAgentOk } from './runner.js';

const TIMEOUT_MS = 45 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

/**
 * Feed-mode synthesize: turn one digest of allowlisted feed items into ONE time-window
 * note and fold its signal into the landscape/report against the thesis. Combines
 * what read+synthesize do for the paper path, since the input is already-filtered
 * short text (no deep-read, no semantic triage — the account allowlist is the filter).
 */
export async function feedSynthesize(ctx: RunContext): Promise<void> {
  if (!ctx.feedDigest) throw new Error('feed-synthesize requires ctx.feedDigest');

  const activeDir = join(ctx.projectRoot, 'notes', 'active');
  mkdirSync(activeDir, { recursive: true });
  const nextNum = nextNoteNumber(ctx.projectRoot).toString().padStart(2, '0');
  const date = ctx.feedDigest.meta.fetchedAt.slice(0, 10);
  const sourceSlug = digestSourceSlug(ctx.feedDigest.meta.source);
  const noteFilename = `${nextNum}_${sourceSlug}-${date}.md`;
  const relPath = `notes/active/${noteFilename}`;

  const landscapePath = join(ctx.projectRoot, LANDSCAPE);
  if (!existsSync(landscapePath)) {
    mkdirSync(dirname(landscapePath), { recursive: true });
    writeFileSync(landscapePath, '# Research landscape\n\n_(empty — will be populated by researcher)_\n');
  }
  const reportPath = join(ctx.projectRoot, 'report.md');
  const readmePath = join(ctx.projectRoot, 'README.md');
  const contradictionsPath = ctx.runDir.path('contradictions.md');
  ctx.contradictionsPath = contradictionsPath;

  const zoneManifest = ctx.zoneManifest ?? listIntegratedNotes(ctx.projectRoot)
    .sort((a, b) => a.num - b.num)
    .map((n) => `${String(n.num).padStart(2, '0')} ${n.zone}`)
    .join('\n');

  const userPrompt = renderTemplate(loadPromptTemplate('stage-feed-synthesize.md'), {
    language: ctx.language,
    zone_manifest: zoneManifest || '(no notes)',
    methodology_synthesis: ctx.methodology.get('04-synthesis.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    thesis: ctx.thesis.body,
    charter: ctx.charter ?? '(no charter synced)',
    digest_content: ctx.feedDigest.content,
    landscape_current: readFileSync(landscapePath, 'utf8'),
    report_current: existsSync(reportPath)
      ? readFileSync(reportPath, 'utf8')
      : '(not yet created — create report.md from scratch)',
    readme_current: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '(no README.md)',
    note_filename: relPath,
    contradictions_path: contradictionsPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  assertAgentOk(ctx.runDir, 'feed-synthesize', result);

  const notePath = join(ctx.projectRoot, relPath);
  if (!existsSync(notePath)) throw new Error(`feed-synthesize: agent did not write ${notePath}`);
  // 兜底:若 agent 没写 frontmatter,补一个默认 active 头,保证下游 listNotes 一致。
  const written = readFileSync(notePath, 'utf8');
  const { body } = parseNote(written);
  if (!written.startsWith('---\n')) writeFileSync(notePath, serializeNote({ ...DEFAULT_FM }, body));
  ctx.newNoteFilename = noteFilename;
  ctx.newNoteRelPath = relPath;
  ctx.newNoteContent = readFileSync(notePath, 'utf8');

  // Hand the digest id to package as the consumed-source marker.
  ctx.addSourceId = digestId(ctx.feedDigest.meta);
  ctx.triageReason = `x-inbox digest ${ctx.feedDigest.filename}: ${ctx.feedDigest.meta.count} item(s)`;

  try {
    const { stdout } = await execa('git', ['diff', '--', LANDSCAPE], { cwd: ctx.projectRoot });
    ctx.landscapeDiff = stdout;
  } catch {
    ctx.landscapeDiff = `(diff unavailable; landscape now reads:\n${readFileSync(landscapePath, 'utf8')})`;
  }
}
