import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const require = createRequire(import.meta.url);

const MILKIE_BIN = resolveMilkieBin();
const MILKIE_AGENT = process.env.RESEARCHER_MILKIE_AGENT ?? 'researcher';

export class MilkieAdapter implements AgentRuntime {
  readonly id = 'milkie';

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const dir = mkdtempSync(join(tmpdir(), 'researcher-milkie-'));
    const inputPath = join(dir, 'input.md');
    const input = [
      '# System prompt',
      stripNul(opts.systemPrompt),
      '',
      '# User prompt',
      stripNul(opts.userPrompt),
      '',
    ].join('\n');
    writeFileSync(inputPath, input);

    try {
      const result = await execa(
        MILKIE_BIN,
        [
          'agent',
          'run',
          MILKIE_AGENT,
          '--input-file',
          inputPath,
          '--goal',
          'Complete the researcher stage exactly as instructed.',
        ],
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? 30 * 60 * 1000,
          reject: false,
        },
      );
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      const output = extractMilkieOutput(stdout);
      const runId = extractMilkieRunId(stdout);
      const exitCode = result.exitCode ?? 1;
      // When milkie fails, prefer a human-readable CLI error from stdout/stderr
      // over a bare "exit code N" at the call site.
      const failureDetail = exitCode === 0 ? '' : extractMilkieErrorMessage(stdout, stderr);
      return {
        output: exitCode === 0 ? output : (failureDetail || output),
        exitCode,
        modifiedFiles: parseFilesModified(output || stdout),
        stderr,
        finishReason: runId ? readMilkieFinishReason(opts.cwd, runId) : undefined,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function extractMilkieRunId(stdout: string): string | undefined {
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!last) return undefined;
  try {
    const parsed = JSON.parse(last) as { runId?: unknown };
    return typeof parsed.runId === 'string' ? parsed.runId : undefined;
  } catch {
    return undefined;
  }
}

function readMilkieFinishReason(cwd: string, runId: string): string | undefined {
  const path = join(cwd, '.milkie', 'runs', `${runId}.jsonl`);
  if (!existsSync(path)) return undefined;
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).reverse();
    for (const line of lines) {
      const ev = JSON.parse(line) as { type?: unknown; payload?: { response?: { finishReason?: unknown } } };
      if (ev.type !== 'llm.responded') continue;
      const finishReason = ev.payload?.response?.finishReason;
      if (typeof finishReason === 'string') return finishReason;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function stripNul(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: matches NUL
  return s.replace(/\u0000/g, '');
}

export function resolveMilkieBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RESEARCHER_MILKIE_BIN) return env.RESEARCHER_MILKIE_BIN;

  try {
    const pkgPath = require.resolve('@freemanxu/milkie/package.json');
    const pkg = require(pkgPath) as { bin?: string | Record<string, string> };
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.milkie;
    if (binRel) return join(dirname(pkgPath), binRel);
  } catch {
    // Fall back to PATH for dev checkouts or manually installed runtimes.
  }

  return 'milkie';
}

function extractMilkieErrorMessage(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (!combined) return '';
  // milkie often prints a single JSON line: {"error":{"code":"…","message":"…"}}
  for (const line of combined.split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(t) as { error?: { message?: unknown; code?: unknown } };
      const msg = parsed.error?.message;
      if (typeof msg === 'string' && msg.trim()) {
        const code = typeof parsed.error?.code === 'string' ? parsed.error.code : '';
        return code ? `${code}: ${msg.trim()}` : msg.trim();
      }
    } catch {
      // keep scanning
    }
  }
  // Fall back to a short tail so UI errors stay readable.
  const tail = combined.split('\n').filter(Boolean).slice(-6).join('\n');
  return tail.length > 800 ? `${tail.slice(0, 800)}…` : tail;
}

function extractMilkieOutput(stdout: string): string {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const last = lines.at(-1);
  if (!last) return stdout;
  try {
    const parsed = JSON.parse(last) as { lastOutput?: unknown; output?: unknown };
    const out = parsed.lastOutput ?? parsed.output;
    if (typeof out === 'string') return out;
  } catch {
    // Plain-text provider output is still accepted.
  }
  return stdout;
}

function parseFilesModified(output: string): string[] {
  const m = /FILES_MODIFIED:\s*\n([\s\S]*?)(?:\n\n|$)/.exec(output);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
