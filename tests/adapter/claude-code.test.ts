import { describe, it, expect, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(async (_bin: string, args: string[], _opts: object) => ({
    exitCode: 0,
    stdout: 'hello\n\nFILES_MODIFIED:\nnotes/01_x.md\n',
    stderr: '',
    args,
  })),
}));

import { ClaudeCodeAdapter } from '../../src/adapter/claude-code.js';

describe('ClaudeCodeAdapter', () => {
  it('invokes claude -p with correct args', async () => {
    const a = new ClaudeCodeAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'SYS', userPrompt: 'USR' });
    expect(r.exitCode).toBe(0);
    expect(r.modifiedFiles).toEqual(['notes/01_x.md']);
  });

  it('does not grant Bash to the agent (untrusted paper content reaches the prompt)', async () => {
    const { execa } = await import('execa');
    const a = new ClaudeCodeAdapter();
    await a.invoke({ cwd: '/tmp/x', systemPrompt: 'SYS', userPrompt: 'USR' });
    const lastCall = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const args = lastCall?.[1] as string[];
    const allowedToolsIdx = args.indexOf('--allowedTools');
    expect(allowedToolsIdx).toBeGreaterThanOrEqual(0);
    const tools = args[allowedToolsIdx + 1].split(',');
    expect(tools).not.toContain('Bash');
  });
});
