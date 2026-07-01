import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const MILKIE_BIN = process.env.RESEARCHER_MILKIE_BIN ?? 'milkie';
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
      const output = extractMilkieOutput(stdout);
      return {
        output,
        exitCode: result.exitCode ?? 1,
        modifiedFiles: parseFilesModified(output || stdout),
        stderr: result.stderr ?? '',
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function stripNul(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: matches NUL
  return s.replace(/\u0000/g, '');
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
