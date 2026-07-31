import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

import { MilkieAdapter, resolveMilkieAgent, resolveMilkieBin } from '../../src/adapter/milkie.js';

describe('MilkieAdapter', () => {
  it('invokes milkie agent run with an input file', async () => {
    const { execa } = await import('execa');
    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'SYS', userPrompt: 'USR' });
    expect(r.exitCode).toBe(0);
    expect(r.output).toBe('hello\n\nFILES_MODIFIED:\nnotes/active/01_x.md\n');
    expect(r.modifiedFiles).toEqual(['notes/active/01_x.md']);

    const lastCall = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[0]).toContain('@freemanxu/milkie');
    expect(lastCall?.[0]).toMatch(/dist\/cli\/index\.js$/);
    const args = lastCall?.[1] as string[];
    expect(args.slice(0, 3)).toEqual(['agent', 'run', 'researcher']);
    expect(args).toContain('--input-file');
  });

  it('invokes the requested Milkie agent', async () => {
    const { execa } = await import('execa');
    const a = new MilkieAdapter();
    await a.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      agentId: 'researcher-triage',
    });

    const lastCall = (execa as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const args = lastCall?.[1] as string[];
    expect(args.slice(0, 3)).toEqual(['agent', 'run', 'researcher-triage']);
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

  it.each([
    [0, 1],
    [17, 17],
  ])('normalizes terminal status:error with process exit %i', async (processExitCode, expectedExitCode) => {
    const { execa } = await import('execa');
    const root = mkdtempSync(join(tmpdir(), 'rsw-milkie-terminal-error-'));
    const runId = `run-error-${processExitCode}`;
    mkdirSync(join(root, '.milkie/runs'), { recursive: true });
    writeFileSync(
      join(root, `.milkie/runs/${runId}.jsonl`),
      JSON.stringify({
        type: 'llm.responded',
        payload: { response: { finishReason: 'length', content: [], toolCalls: [] } },
      }) + '\n',
    );
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: processExitCode,
      stdout: JSON.stringify({
        runId,
        status: 'error',
        lastOutput: 'invalid tool arguments',
        error: {
          code: 'AGENT_RUN_ERROR',
          message: 'The agent could not complete the run.',
          phase: 'tool_arguments',
          retryable: false,
          toolCallId: 'call_1',
          finishReason: 'length',
        },
      }) + '\n',
      stderr: 'fallback stderr',
      args: [],
    });

    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: root, systemPrompt: 'S', userPrompt: 'U' });

    expect(r.exitCode).toBe(expectedExitCode);
    expect(r.finishReason).toBe('length');
    expect(r.error).toMatchObject({
      code: 'AGENT_RUN_ERROR',
      message: 'The agent could not complete the run.',
    });
  });

  it('reads a terminal error envelope from stderr', async () => {
    const { execa } = await import('execa');
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        runId: 'run-stderr-error',
        status: 'error',
        lastOutput: 'invalid tool arguments',
      }) + '\n',
      stderr: JSON.stringify({
        error: {
          code: 'AGENT_RUN_ERROR',
          message: 'The agent could not complete the run.',
          status: 'error',
          runId: 'run-stderr-error',
          contextId: 'ctx-1',
          details: { kind: 'tool_failure' },
        },
      }) + '\n',
      args: [],
    });

    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'S', userPrompt: 'U' });

    expect(r.exitCode).toBe(1);
    expect(r.error).toMatchObject({
      code: 'AGENT_RUN_ERROR',
      message: 'The agent could not complete the run.',
      details: { kind: 'tool_failure' },
    });
  });


  it('surfaces lastOutput when status=error has no error envelope', async () => {
    const { execa } = await import('execa');
    const msg =
      '404 The requested model does not support the coding plan feature. Please refer to the documentation at https://www.volcengine.com/docs/82379/1925114 to select a compatible model.';
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        JSON.stringify({
          runId: 'run-model-404',
          status: 'error',
          lastOutput: msg,
        }) + '\n',
      stderr: '',
      args: [],
    });
    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'S', userPrompt: 'U' });
    expect(r.exitCode).toBe(1);
    expect(r.output).toBe(msg);
    expect(r.output).not.toContain('"status":"error"');
  });
  it('treats an omitted process exit code as failure', async () => {
    const { execa } = await import('execa');
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      stdout: JSON.stringify({ status: 'completed', lastOutput: 'partial output' }) + '\n',
      stderr: '',
      args: [],
    });

    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'S', userPrompt: 'U' });

    expect(r.exitCode).toBe(1);
  });
  it('recovers finishReason from the Milkie run trace', async () => {
    const { execa } = await import('execa');
    const root = mkdtempSync(join(tmpdir(), 'rsw-milkie-trace-'));
    const runId = 'run-with-length';
    mkdirSync(join(root, '.milkie/runs'), { recursive: true });
    writeFileSync(
      join(root, `.milkie/runs/${runId}.jsonl`),
      JSON.stringify({
        type: 'llm.responded',
        payload: { response: { finishReason: 'length', content: [], toolCalls: [] } },
      }) + '\n',
    );
    (execa as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({ runId, status: 'completed', lastOutput: '' }) + '\n',
      stderr: '',
      args: [],
    });

    const a = new MilkieAdapter();
    const r = await a.invoke({ cwd: root, systemPrompt: 'S', userPrompt: 'U' });
    expect(r.finishReason).toBe('length');
  });

  it('allows RESEARCHER_MILKIE_BIN to override the packaged runtime', () => {
    expect(resolveMilkieBin({ RESEARCHER_MILKIE_BIN: '/custom/milkie' })).toBe('/custom/milkie');
  });

  it('allows RESEARCHER_MILKIE_AGENT to set the default agent', () => {
    expect(resolveMilkieAgent({ RESEARCHER_MILKIE_AGENT: 'custom-researcher' })).toBe('custom-researcher');
  });
});
