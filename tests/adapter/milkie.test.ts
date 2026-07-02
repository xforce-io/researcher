import { describe, it, expect, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(async (_bin: string, args: string[], _opts: object) => ({
    exitCode: 0,
    stdout: JSON.stringify({
      status: 'completed',
      lastOutput: 'hello\n\nFILES_MODIFIED:\nnotes/active/01_x.md\n',
    }) + '\n',
    stderr: '',
    args,
  })),
}));

import { MilkieAdapter } from '../../src/adapter/milkie.js';

describe('MilkieAdapter', () => {
  it('invokes milkie agent run with an input file', async () => {
    const { execa } = await import('execa');
    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'SYS', userPrompt: 'USR' });
    expect(r.exitCode).toBe(0);
    expect(r.modifiedFiles).toEqual(['notes/active/01_x.md']);

    const lastCall = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('milkie');
    const args = lastCall?.[1] as string[];
    expect(args.slice(0, 3)).toEqual(['agent', 'run', 'researcher']);
    expect(args).toContain('--input-file');
  });

  it('strips NUL bytes before writing the milkie input', async () => {
    const { execa } = await import('execa');
    const a = new MilkieAdapter();
    await a.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'sys\0head',
      userPrompt: 'pdf\0body\0end',
    });
    const lastCall = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const args = lastCall?.[1] as string[];
    expect(args).toContain('--input-file');
  });

  it('surfaces stderr from the underlying process', async () => {
    const { execa } = await import('execa');
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'partial output\n',
      stderr: 'the real failure reason',
      args: [],
    });
    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'S', userPrompt: 'U' });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('the real failure reason');
  });
});
