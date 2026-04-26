import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { parseTriaged } from '../config/triaged.js';
import { Seen } from '../state/seen.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 15 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

export async function discoverTriage(ctx: RunContext): Promise<void> {
  const triagedPath = ctx.runDir.path('triaged.json');
  const seen = new Seen(join(ctx.researcherDir, 'state/seen.jsonl'));

  const landscapePath = join(ctx.projectRoot, LANDSCAPE);
  const landscapeCurrent = existsSync(landscapePath) ? readFileSync(landscapePath, 'utf8') : '(no landscape yet)';

  // Render seen IDs as a bare newline-separated list — the prompt only needs the IDs for dedup hints.
  const seenIds = listSeenIds(join(ctx.researcherDir, 'state/seen.jsonl'));

  const userPrompt = renderTemplate(loadPromptTemplate('stage-discover-triage.md'), {
    methodology_source: ctx.methodology.get('02-source.md') ?? '',
    methodology_filtering: ctx.methodology.get('03-filtering.md') ?? '',
    project_yaml: readFileSync(join(ctx.researcherDir, 'project.yaml'), 'utf8'),
    thesis: ctx.thesis.body,
    seen_ids: seenIds.length > 0 ? seenIds.join('\n') : '(none)',
    landscape_current: landscapeCurrent,
    triaged_path: triagedPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode !== 0) throw new Error(`discover_triage stage agent exited ${result.exitCode}`);
  if (!existsSync(triagedPath)) throw new Error(`discover_triage: agent did not produce ${triagedPath}`);

  const triaged = parseTriaged(readFileSync(triagedPath, 'utf8'));

  // Persist skim + reject decisions to seen.jsonl (dedup ledger).
  // deep-read entries are persisted later by the package stage so that a crash
  // before deep-read finishes leaves the candidate eligible on the next tick.
  for (const c of triaged.candidates) {
    if (seen.has(c.id)) continue;
    if (c.decision === 'deep-read') continue;
    seen.append({
      id: c.id,
      source: c.source,
      first_seen_run: ctx.runDir.id,
      decision: c.decision,
      reason: c.reason,
    });
  }

  // Pick the first deep-read candidate that isn't already in seen.jsonl.
  const pick = triaged.candidates.find((c) => c.decision === 'deep-read' && !seen.has(c.id));
  if (pick) {
    if (!pick.id.startsWith('arxiv:')) {
      // Plan 2: read stage still arxiv-only. Non-arxiv deep-reads are recorded but not deep-read this tick.
      seen.append({
        id: pick.id,
        source: pick.source,
        first_seen_run: ctx.runDir.id,
        decision: 'skim',
        reason: `${pick.reason} (downgraded: read stage is arxiv-only in Plan 2)`,
      });
      return;
    }
    ctx.addArxivId = pick.id;
    ctx.triageReason = pick.reason;
  }
}

function listSeenIds(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return (JSON.parse(line) as { id: string }).id;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}
