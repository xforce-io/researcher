import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { RUN_IPC_ENV } from '../../src/pipeline/events.js';
import { PaperLibrary } from '../../src/library/store.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class ScriptedAdapter implements AgentRuntime {
  id = 'scripted';
  callCount = 0;
  constructor(private readonly script: Array<(opts: InvokeOptions) => InvokeResult | Promise<InvokeResult>>) {}
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const step = this.script[this.callCount++];
    if (!step) throw new Error(`scripted adapter ran out of steps at call ${this.callCount}`);
    return step(opts);
  }
}

function soulStep(): (opts: InvokeOptions) => InvokeResult {
  return () => ({ output: 'no changes needed\nSOUL_DECISION: skip\n', modifiedFiles: [], exitCode: 0 });
}
function synthesizeStep(expectIncludes: string): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    expect(opts.userPrompt).toContain(expectIncludes);
    const landscape = join(opts.cwd, 'notes/00_research_landscape.md');
    writeFileSync(landscape, readFileSync(landscape, 'utf8') + '\n- new entry\n');
    const cm = /`([^`]+contradictions\.md)`/.exec(opts.userPrompt);
    if (!cm) throw new Error('synthesize step: no contradictions path');
    writeFileSync(cm[1], 'none\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}
function packageStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    const m = /`([^`]+run-summary\.md)`/.exec(opts.userPrompt);
    if (!m) throw new Error('package step: no run_summary_path');
    mkdirSync(join(m[1], '..'), { recursive: true });
    writeFileSync(m[1], '## Run summary\n\n## Devil\'s-advocate pass\n\n## Confidence labels\n\n## What would change my mind\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}

function activeNotes(proj: string): string[] {
  const dir = join(proj, 'notes/active');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
}

/** #197 S5–S6: a linked video is integrated from its transcript, or held back. */
describe('topic Run integrates linked videos (#197 S5–S6)', () => {
  let proj: string;
  let _origSend: typeof process.send;
  let _origRunIpc: string | undefined;
  const videoId = `doc_${randomUUID()}`;

  beforeEach(async () => {
    _origSend = process.send;
    _origRunIpc = process.env[RUN_IPC_ENV];
    (process as { send?: unknown }).send = undefined;
    delete process.env[RUN_IPC_ENV];

    proj = mkdtempSync(join(tmpdir(), 'r-run-vid-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    const pyPath = join(proj, '.researcher/project.yaml');
    writeFileSync(pyPath, readFileSync(pyPath, 'utf8').replace('your topic keyword', 'test query'));
    execaSync('git', ['add', '.researcher', '.milkie', 'agents', '.gitignore'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
    mkdirSync(join(proj, 'notes', 'active'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
  });

  afterEach(() => {
    (process as { send?: unknown }).send = _origSend;
    if (_origRunIpc === undefined) delete process.env[RUN_IPC_ENV];
    else process.env[RUN_IPC_ENV] = _origRunIpc;
  });

  /** Video document linked to the topic; cues only when `withCues`. */
  function seedLinkedVideo(withCues: boolean): PaperLibrary {
    const lib = new PaperLibrary(proj, { now: () => '2026-09-13T00:00:00.000Z' });
    const media = join(tmpdir(), `trust-curve-talk-${randomUUID()}.mp4`);
    writeFileSync(media, Buffer.from('mp4-bytes'));
    lib.createVideo({
      id: videoId,
      sourcePath: media,
      filename: 'Trust curve talk.mp4',
      contentType: 'video/mp4',
      bytes: Buffer.from('mp4-bytes').length,
      mutationId: 'v1',
    });
    if (withCues) {
      lib.writeVideoAnalysis({
        id: 'analysis_1',
        documentId: videoId,
        status: 'done',
        createdAt: '2026-09-13T00:00:00.000Z',
        updatedAt: '2026-09-13T00:00:00.000Z',
        mutationId: 'an1',
        noSpeech: false,
        cues: [
          { id: 0, start: 0, end: 2, text: 'Trust the harness', zh: '信任这套 harness' },
          { id: 1, start: 63, end: 66, text: 'Agents merged twenty PRs' },
        ],
      });
    }
    // Run is driven with an explicit topicPath below; the link must match it.
    lib.upsertLink({ paperId: videoId, surfaceType: 'topic', surfaceId: 'agents' });
    return lib;
  }

  it('integrates a linked video from its transcript and does not repeat (S5)', async () => {
    seedLinkedVideo(true);
    const adapter = new ScriptedAdapter([
      soulStep(),
      synthesizeStep('Trust the harness'),
      packageStep(),
    ]);
    const { runRun } = await import('../../src/commands/run.js');
    const first = await runRun({ cwd: proj, workspaceRoot: proj, topicPath: 'agents', adapter });
    expect(first.outcome).toBe('completed');

    const notes = activeNotes(proj);
    expect(notes).toHaveLength(1);
    const note = readFileSync(join(proj, 'notes/active', notes[0]), 'utf8');
    expect(note).toContain('Transcript');
    expect(note).toContain('[0:00] Trust the harness');
    expect(note).toContain('信任这套 harness');
    expect(note).toContain('[1:03] Agents merged twenty PRs');
    expect(note).not.toContain('Library read artifact');

    const lib = new PaperLibrary(proj);
    expect(lib.listIntegrations(videoId)).toHaveLength(1);
    // A video has no source ref: seen.jsonl is the discover watermark only.
    const seenPath = join(proj, '.researcher/state/seen.jsonl');
    expect(existsSync(seenPath) ? readFileSync(seenPath, 'utf8') : '').not.toContain(videoId);

    const second = await runRun({
      cwd: proj,
      workspaceRoot: proj,
      topicPath: 'agents',
      adapter: new ScriptedAdapter([]),
    });
    expect(second.outcome).toBe('all-integrated');
    expect(activeNotes(proj)).toHaveLength(1);
  });

  it('holds back a video with no transcript instead of writing an empty note (S6)', async () => {
    seedLinkedVideo(false);
    const { runRun } = await import('../../src/commands/run.js');
    const logs: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: unknown }).write = ((chunk: string) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const res = await runRun({ cwd: proj, workspaceRoot: proj, topicPath: 'agents', adapter: new ScriptedAdapter([]) });
      expect(res.outcome).toBe('blocked-queue');
    } finally {
      (process.stdout as { write: unknown }).write = origWrite;
    }
    const out = logs.join('');
    expect(out).toContain(videoId);
    expect(out).toContain('analyze the video first');
    expect(activeNotes(proj)).toHaveLength(0);
    expect(new PaperLibrary(proj).listIntegrations(videoId)).toHaveLength(0);
  });
});
