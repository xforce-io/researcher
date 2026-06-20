import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import type { RunContext } from './context.js';
import { assertAgentOk } from './runner.js';

const TIMEOUT_MS = 45 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

/**
 * Max targets to verify per tick — a cost guard so one window can't fan into an
 * unbounded web-research run. The agent is told to pick the top-N highest-leverage
 * "下一步:补 X 数据" items and to log (not silently drop) the rest.
 */
export const ENRICH_TOP_N = 5;

/**
 * Feed-mode enrich/verify stage (#27). Runs AFTER feed-synthesize, BEFORE package, and only
 * when the x-inbox source opted in via `enrich: true`. The feed's input — allowlisted short
 * opinions with no external links — gives the report reasoning depth but no empirical depth:
 * nearly every 净判断 ends "下一步:补 X 数据". This stage closes that gap researcher-side
 * (it cannot live in the pure-data-source feeds repo): it hands the agent the just-written
 * window note + current report, has it look up primary fundamental data (订单/价格/产能/稼动率/
 * 毛利/官媒原文) for the window's named targets, adversarially verify (refute + find a primary
 * source, attach a source URL + confidence), and fold the evidence back IN PLACE (B1) into the
 * window note and report. Unresolved items stay in 「待证实」.
 */
export async function feedEnrich(ctx: RunContext): Promise<void> {
  if (!ctx.newNoteFilename) {
    throw new Error('feed-enrich requires ctx.newNoteFilename (run it after feed-synthesize)');
  }
  const notePath = join(ctx.projectRoot, 'notes', ctx.newNoteFilename);
  const reportPath = join(ctx.projectRoot, 'report.md');
  const landscapePath = join(ctx.projectRoot, LANDSCAPE);

  const userPrompt = renderTemplate(loadPromptTemplate('stage-feed-enrich.md'), {
    language: ctx.language,
    methodology_source: ctx.methodology.get('02-source.md') ?? '',
    methodology_verification: ctx.methodology.get('05-verification.md') ?? '',
    thesis: ctx.thesis.body,
    charter: ctx.charter ?? '(no charter synced)',
    top_n: String(ENRICH_TOP_N),
    note_filename: ctx.newNoteFilename,
    note_content: ctx.newNoteContent ?? readFileSync(notePath, 'utf8'),
    report_current: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '(no report.md yet)',
    landscape_current: existsSync(landscapePath)
      ? readFileSync(landscapePath, 'utf8')
      : '(no landscape yet)',
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  assertAgentOk(ctx.runDir, 'feed-enrich', result);

  // The agent edited the note (and report) in place (B1). Refresh the carry so package's
  // dirty-check and commit see the enriched content, not the pre-enrich snapshot.
  if (existsSync(notePath)) ctx.newNoteContent = readFileSync(notePath, 'utf8');
}
