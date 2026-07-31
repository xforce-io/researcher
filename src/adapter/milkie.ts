import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import type { AgentRuntime, InvokeError, InvokeOptions, InvokeResult } from './interface.js';

const require = createRequire(import.meta.url);

const MILKIE_BIN = resolveMilkieBin();
const MILKIE_AGENT = process.env.RESEARCHER_MILKIE_AGENT ?? 'researcher';

interface MilkieTerminal {
  runId?: unknown;
  status?: unknown;
  lastOutput?: unknown;
  output?: unknown;
  error?: unknown;
}

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
      const terminal = parseMilkieTerminal(stdout);
      const output = extractMilkieOutput(stdout, terminal);
      const runId = typeof terminal?.runId === 'string' ? terminal.runId : undefined;
      const parsedTerminalError = parseTerminalError(terminal);
      const error = terminal?.status === 'error' ? parsedTerminalError : undefined;
      const processExitCode = result.exitCode;
      const exitCode = processExitCode && processExitCode !== 0
        ? processExitCode
        : terminal?.status === 'error'
          ? 1
          : 0;
      // When milkie fails, prefer its structured terminal error over a bare
      // exit code or less specific stderr text at the call site.
      const failureDetail = exitCode === 0
        ? ''
        : extractMilkieErrorMessage(stdout, stderr, parsedTerminalError);
      return {
        output: exitCode === 0 ? output : (failureDetail || output),
        exitCode,
        modifiedFiles: parseFilesModified(output || stdout),
        stderr,
        finishReason: runId ? readMilkieFinishReason(opts.cwd, runId) : undefined,
        error,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function parseMilkieTerminal(stdout: string): MilkieTerminal | undefined {
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!last) return undefined;
  try {
    const parsed: unknown = JSON.parse(last);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as MilkieTerminal;
  } catch {
    return undefined;
  }
}

function parseTerminalError(terminal: MilkieTerminal | undefined): InvokeError | undefined {
  if (typeof terminal?.error !== 'object' || terminal.error === null || Array.isArray(terminal.error)) {
    return undefined;
  }
  const { code: rawCode, message: rawMessage, details } = terminal.error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) return undefined;

  const message = rawMessage.trim();
  const code = typeof rawCode === 'string' && rawCode.trim() ? rawCode : undefined;
  return details === undefined ? { code, message } : { code, message, details };
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

function extractMilkieErrorMessage(
  stdout: string,
  stderr: string,
  terminalError: InvokeError | undefined,
): string {
  if (terminalError) {
    return terminalError.code ? `${terminalError.code}: ${terminalError.message}` : terminalError.message;
  }
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (!combined) return '';
  // Fall back to a short tail so UI errors stay readable.
  const tail = combined.split('\n').filter(Boolean).slice(-6).join('\n');
  return tail.length > 800 ? `${tail.slice(0, 800)}…` : tail;
}

function extractMilkieOutput(stdout: string, terminal: MilkieTerminal | undefined): string {
  const out = terminal?.lastOutput ?? terminal?.output;
  return typeof out === 'string' ? out : stdout;
}

function parseFilesModified(output: string): string[] {
  const m = /FILES_MODIFIED:\s*\n([\s\S]*?)(?:\n\n|$)/.exec(output);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
