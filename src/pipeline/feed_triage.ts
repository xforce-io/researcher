import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { parseFeedTriaged } from '../config/feed-triaged.js';
import { Seen } from '../state/seen.js';
import { digestId } from '../sources/inbox.js';
import type { RunContext } from './context.js';
import { assertAgentOk } from './runner.js';

const TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Feed-mode triage: read one inbox digest, keep the thesis-relevant subset of tweets.
 * Records per-tweet decisions to seen.jsonl. If nothing is kept, marks the digest
 * consumed so the next tick doesn't re-triage it, and leaves ctx.keptItems empty.
 */
export async function feedTriage(ctx: RunContext): Promise<void> {
  if (!ctx.feedDigest) throw new Error('feed-triage requires ctx.feedDigest');
  const triagedPath = ctx.runDir.path('feed-triaged.json');

  const userPrompt = renderTemplate(loadPromptTemplate('stage-feed-triage.md'), {
    language: ctx.language,
    methodology_filtering: ctx.methodology.get('03-filtering.md') ?? '',
    project_yaml: readFileSync(join(ctx.researcherDir, 'project.yaml'), 'utf8'),
    thesis: ctx.thesis.body,
    digest_content: ctx.feedDigest.content,
    triaged_path: triagedPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  assertAgentOk(ctx.runDir, 'feed-triage', result);
  if (!existsSync(triagedPath)) throw new Error(`feed-triage: agent did not produce ${triagedPath}`);

  const triaged = parseFeedTriaged(readFileSync(triagedPath, 'utf8'));
  const seen = new Seen(join(ctx.researcherDir, 'state/seen.jsonl'));

  for (const k of triaged.kept) {
    if (seen.has(k.id)) continue;
    seen.append({ id: k.id, source: 'x-inbox', first_seen_run: ctx.runDir.id, decision: 'deep-read', reason: k.reason });
  }
  for (const d of triaged.dropped) {
    if (seen.has(d.id)) continue;
    seen.append({ id: d.id, source: 'x-inbox', first_seen_run: ctx.runDir.id, decision: 'reject', reason: d.reason });
  }

  ctx.keptItems = triaged.kept;

  // Nothing relevant: consume the digest here (package won't run) so it isn't re-picked.
  if (triaged.kept.length === 0) {
    const id = digestId(ctx.feedDigest.meta);
    if (!seen.has(id)) {
      seen.append({
        id,
        source: 'x-inbox',
        first_seen_run: ctx.runDir.id,
        decision: 'reject',
        reason: `no thesis-relevant tweets in digest (${triaged.dropped.length} dropped)`,
      });
    }
  }
}
