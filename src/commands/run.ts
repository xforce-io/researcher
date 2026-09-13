import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentRuntime } from '../adapter/runtime.js';
import type { AgentRuntime } from '../adapter/interface.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { withLock } from '../state/lock.js';
import { runStages } from '../pipeline/runner.js';
import { emitEvent } from '../pipeline/events.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { soulBootstrap } from '../pipeline/soul_bootstrap.js';
import { discoverTriage } from '../pipeline/discover_triage.js';
import { libraryTopicRead, finalizeLibraryIntegration } from '../pipeline/library_topic_read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { rebalance } from '../pipeline/rebalance.js';
import { packageStage } from '../pipeline/package.js';
import { classifyContradictions } from '../pipeline/contradictions.js';
import { integrationSourceState } from '../pipeline/integration_source.js';
import type { RunContext } from '../pipeline/context.js';
import type { LibraryReadRunner } from '../web/library-read.js';
import { PaperLibrary } from '../library/store.js';


export interface RunOptions {
  cwd: string;
  workspaceRoot?: string;
  topicPath?: string;
  /** Injectable for tests. Production: configured runtime factory. */
  adapter?: AgentRuntime;
  libraryReadRunner?: LibraryReadRunner;
  /**
   * When true, allow arxiv discover/collect+triage if no pending linked paper.
   * Default false: Run only integrates Library-linked queue (#140).
   */
  discover?: boolean;
}

/** What a single autonomous tick concluded — surfaced for workspace summaries. */
export type RunOutcome =
  | 'completed'       // deep-read a paper + synthesized + packaged (PR opened)
  | 'no-candidate'    // discover ran but nothing worth deep-reading this tick
  | 'thin-signal'     // soul too thin to draft; punted to open_questions.md
  | 'no-queries'      // discover requested but no arxiv queries configured
  | 'all-integrated'  // linked documents exist and all are integrated; discover off
  | 'blocked-queue'   // linked documents pending but none has an integration source
  | 'nothing-to-run'; // no pending linked document and discover off

export interface RunResult {
  outcome: RunOutcome;
  runId: string;
}

export async function runRun(opts: RunOptions): Promise<RunResult> {
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const adapter = opts.adapter ?? createAgentRuntime();
  const runDir = new RunDir(join(researcherDir, 'state/runs'), newRunId());

  let outcome: RunOutcome = 'completed';
  const setOutcome = (o: RunOutcome) => {
    outcome = o;
    emitEvent({ type: 'outcome', outcome: o });
  };

  await withLock(join(researcherDir, 'state/.lock'), async () => {
    let ctx: RunContext;
    await runStages(runDir, [
      {
        name: 'bootstrap',
        fn: async () => {
          ctx = await bootstrap({ projectRoot: opts.cwd, adapter, runDir });
        },
      },
    ]);

    // Discover off: empty linked queue exits before soul (no LLM).
    if (opts.discover !== true) {
      const workspaceRoot = opts.workspaceRoot ?? opts.cwd;
      const topicPath = opts.topicPath ?? inferTopicPath(workspaceRoot, opts.cwd);
      const scan = scanLinkedLibraryQueue({ workspaceRoot, topicPath });
      if (!scan.candidateId) {
        emitEvent({ type: 'plan', stages: ['bootstrap'] });
        const empty = classifyEmptyLinkedQueue({ workspaceRoot, topicPath, blocked: scan.blocked });
        if (empty === 'blocked-queue') {
          process.stdout.write(
            `autonomous tick: linked documents are waiting but none can be integrated yet — discover off. (${runDir.id})\n` +
            describeBlocked(scan.blocked) +
            `Resolve the reason above, or re-run with --discover to search arxiv.\n`,
          );
          setOutcome('blocked-queue');
        } else if (empty === 'all-integrated') {
          process.stdout.write(
            `autonomous tick: all linked Library documents already integrated — discover off. (${runDir.id})\n` +
            `Link another document, or re-run with --discover to search arxiv.\n`,
          );
          setOutcome('all-integrated');
        } else {
          process.stdout.write(
            `autonomous tick: nothing to run — no pending linked document and discover off. (${runDir.id})\n` +
            `Link a Library document, or re-run with --discover to search arxiv.\n`,
          );
          setOutcome('nothing-to-run');
        }
        return;
      }
    }

    await runStages(runDir, [
      { name: 'soul', fn: async () => soulBootstrap(ctx!) },
    ]);

    if (ctx!.needsHumanInput) {
      process.stdout.write(
        `autonomous tick: signal too thin to draft project soul. ` +
        `see .researcher/open_questions.md, fill it in, then re-run. (${runDir.id})\n`,
      );
      setOutcome('thin-signal');
      return;
    }

    const hasRealQueries = ctx!.projectYaml.sources.some(
      (s) => s.queries && s.queries.some((q) => q.trim() !== '' && q !== 'your topic keyword')
    );

    // Prefer Library papers already linked to this topic but not yet integrated —
    // users see them under Related papers and expect Run to consume them.
    const workspaceRoot = opts.workspaceRoot ?? opts.cwd;
    const topicPath = opts.topicPath ?? inferTopicPath(workspaceRoot, opts.cwd);
    const scan = scanLinkedLibraryQueue({ workspaceRoot, topicPath });

    if (scan.candidateId) {
      emitEvent({
        type: 'plan',
        stages: ['bootstrap', 'soul', 'read', 'rebalance', 'synthesize', 'package'],
      });
      ctx!.addDocumentId = scan.candidateId;
      ctx!.triageReason = 'library-linked candidate (not yet in landscape)';
      process.stdout.write(
        `autonomous tick: using library-linked candidate ${scan.candidateId} (skip discover). (${runDir.id})\n` +
        (scan.blocked.length ? `held back this run:\n${describeBlocked(scan.blocked)}` : ''),
      );
    } else {
      // discover requested (empty-queue fast path already returned above when off)
      emitEvent({
        type: 'plan',
        stages: ['bootstrap', 'soul', 'discover', 'read', 'rebalance', 'synthesize', 'package'],
      });
      if (!hasRealQueries) {
        process.stdout.write(
          `autonomous tick: no arxiv keywords configured — skipping discover stage.\n` +
          `Add queries to .researcher/project.yaml sources[].queries, or use \`researcher add <arxiv-id>\`.\n`
        );
        setOutcome('no-queries');
        return;
      }
      await runStages(runDir, [
        { name: 'discover', fn: async () => discoverTriage(ctx!) },
      ]);
    }

    if (!ctx!.addSourceId && !ctx!.addDocumentId) {
      process.stdout.write(
        `autonomous tick: no deep-read candidate this run (${runDir.id}).\n` +
        `landscape unchanged — link a Library document or wait for discover hits.\n`,
      );
      setOutcome('no-candidate');
      return;
    }

    await runStages(runDir, [
      {
        name: 'read',
        fn: async () => libraryTopicRead(ctx!, {
          workspaceRoot,
          topicPath,
          libraryReadRunner: opts.libraryReadRunner,
        }),
      },
      { name: 'rebalance',  fn: async () => rebalance(ctx!) },
      {
        name: 'synthesize',
        fn: async () => {
          await synthesize(ctx!);
          // Only after landscape content actually changed (synthesize throws otherwise).
          finalizeLibraryIntegration(ctx!, { workspaceRoot, topicPath });
        },
      },
      { name: 'package',    fn: async () => packageStage(ctx!) },
    ]);
    process.stdout.write(`done. run id: ${runDir.id} (integrated: ${ctx!.addDocumentId ?? ctx!.addSourceId})\n`);
    reportContradictions(ctx!);
    setOutcome('completed');
  });
  return { outcome, runId: runDir.id };
}

/** A linked document that cannot be integrated yet, and why. */
export interface BlockedLinkedDocument {
  documentId: string;
  docType: string;
  reason: string;
}

export interface LinkedQueueScan {
  /** Oldest linked document that already has an integration source. */
  candidateId: string | null;
  /** Linked, not yet integrated, but missing an integration source. */
  blocked: BlockedLinkedDocument[];
}

/**
 * Scan the topic's linked queue (#197). Returns the oldest integrable document
 * plus the ones held back, so a video without a transcript can neither be
 * integrated as an empty note nor block the rest of the queue forever.
 */
export function scanLinkedLibraryQueue(opts: {
  workspaceRoot: string;
  topicPath: string;
}): LinkedQueueScan {
  const empty: LinkedQueueScan = { candidateId: null, blocked: [] };
  if (!opts.topicPath) return empty;
  let lib: PaperLibrary;
  try {
    lib = new PaperLibrary(opts.workspaceRoot);
  } catch {
    return empty;
  }
  const integrated = new Set(
    lib.listIntegrations()
      .filter((i) => i.topicId === opts.topicPath)
      .map((i) => i.paperId),
  );
  const links = lib.listLinks()
    .filter((l) => l.surfaceType === 'topic' && l.surfaceId === opts.topicPath)
    .filter((l) => !integrated.has(l.paperId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const blocked: BlockedLinkedDocument[] = [];
  let candidateId: string | null = null;
  for (const link of links) {
    const doc = lib.getDocument(link.paperId);
    if (!doc) continue;
    const state = integrationSourceState(lib, doc);
    if (!state.ready) {
      blocked.push({ documentId: doc.id, docType: doc.docType, reason: state.reason });
      continue;
    }
    if (!candidateId) candidateId = doc.id;
  }
  return { candidateId, blocked };
}

/** Oldest integrable linked document for this topic, as a documentId. */
export function pickLinkedLibraryCandidate(opts: {
  workspaceRoot: string;
  topicPath: string;
}): string | null {
  return scanLinkedLibraryQueue(opts).candidateId;
}

/** No integrable candidate: distinguish blocked queue vs empty vs all done. */
export function classifyEmptyLinkedQueue(opts: {
  workspaceRoot: string;
  topicPath: string;
  blocked?: BlockedLinkedDocument[];
}): 'blocked-queue' | 'all-integrated' | 'nothing-to-run' {
  if (!opts.topicPath) return 'nothing-to-run';
  const blocked = opts.blocked ?? scanLinkedLibraryQueue(opts).blocked;
  if (blocked.length > 0) return 'blocked-queue';
  let lib: PaperLibrary;
  try {
    lib = new PaperLibrary(opts.workspaceRoot);
  } catch {
    return 'nothing-to-run';
  }
  // Only count work that was or is part of the integrate queue.
  const hasIntegration = lib.listIntegrations().some((i) => i.topicId === opts.topicPath);
  return hasIntegration ? 'all-integrated' : 'nothing-to-run';
}

/** Held-back documents must be visible: silence would look like they integrated. */
function describeBlocked(blocked: BlockedLinkedDocument[]): string {
  return blocked.map((b) => `  - ${b.documentId} (${b.docType}): ${b.reason}\n`).join('');
}

function inferTopicPath(workspaceRoot: string, topicDir: string): string {
  const rel = topicDir.startsWith(workspaceRoot)
    ? topicDir.slice(workspaceRoot.length).replace(/^[/\\]/, '')
    : '';
  return rel || topicDir.split(/[/\\]/).filter(Boolean).at(-1) || '';
}


/** Surface contradiction/landscape/charter signals from this run's contradictions.md. */
function reportContradictions(ctx: RunContext): void {
  if (!ctx.contradictionsPath || !existsSync(ctx.contradictionsPath)) return;
  const report = classifyContradictions(readFileSync(ctx.contradictionsPath, 'utf8'));
  if (report.hasContradictions) {
    process.stdout.write(`\ncontradictions found — consider updating .researcher/thesis.md\n`);
  }
  if (report.hasTaxonomyProposal) {
    process.stdout.write(`\nlandscape proposal pending review — see contradictions.md §"Proposed taxonomy extension"\n`);
  }
  if (report.hasCharterTension) {
    process.stdout.write(`\ncharter tension surfaced — see contradictions.md §"Charter tension" (adjudicate: fix pillar or update super-repo CHARTER.md)\n`);
  }
}
