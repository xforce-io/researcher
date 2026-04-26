import { execa } from 'execa';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const CLAUDE_BIN = process.env.RESEARCHER_CLAUDE_BIN ?? 'claude';
// Bash intentionally omitted — paper content from arxiv is untrusted input that
// reaches the agent prompt. WebFetch/WebSearch remain because the methodology
// requires the agent to corroborate claims against external sources.
const ALLOWED_TOOLS = 'Read,Write,Edit,WebFetch,WebSearch';

export class ClaudeCodeAdapter implements AgentRuntime {
  readonly id = 'claude-code';

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const args = [
      '-p',
      opts.userPrompt,
      '--append-system-prompt',
      opts.systemPrompt,
      '--allowedTools',
      ALLOWED_TOOLS,
      '--dangerously-skip-permissions',
    ];
    const result = await execa(CLAUDE_BIN, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30 * 60 * 1000,
      reject: false,
    });
    return {
      output: result.stdout ?? '',
      exitCode: result.exitCode ?? 1,
      modifiedFiles: parseFilesModified(result.stdout ?? ''),
    };
  }
}

function parseFilesModified(output: string): string[] {
  const m = /FILES_MODIFIED:\s*\n([\s\S]*?)(?:\n\n|$)/.exec(output);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
