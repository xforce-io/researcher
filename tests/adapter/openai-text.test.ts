import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  lastClientOptions: undefined as unknown,
  lastRequest: undefined as unknown,
  lastRequestOptions: undefined as unknown,
  requests: [] as unknown[],
  createImpl: null as null | ((request: unknown, options?: unknown) => Promise<unknown>),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options: unknown) => {
    state.lastClientOptions = options;
    return {
      chat: {
        completions: {
          create: vi.fn(async (request: unknown, requestOptions?: unknown) => {
            state.requests.push(request);
            state.lastRequest = request;
            state.lastRequestOptions = requestOptions;
            if (state.createImpl) return state.createImpl(request, requestOptions);
            return {
              choices: [
                { message: { content: '# Read\n\n## Brief\n\nx' }, finish_reason: 'stop' },
              ],
            };
          }),
        },
      },
    };
  }),
}));

import { OpenAITextAdapter, resetThinkingSupportCache } from '../../src/adapter/openai-text.js';

function thinkingUnsupportedError(): Error {
  return Object.assign(
    new Error(
      '400 thinking.type `disabled` is not supported by this model Request id: 021787499694231f0b662e0a22462bcc30964e8c',
    ),
    { status: 400 },
  );
}

describe('OpenAITextAdapter', () => {
  beforeEach(() => {
    resetThinkingSupportCache();
    state.createImpl = null;
    state.requests = [];
    state.lastRequest = undefined;
    state.lastRequestOptions = undefined;
  });

  function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      VOLCENGINE_TOKEN: 'token',
      VOLCENGINE_API_BASE: 'https://example.test/v1',
      ...extra,
    };
  }

  it('passes max_tokens and returns text content', async () => {
    const adapter = new OpenAITextAdapter({
      ...env(),
      VOLCENGINE_MODEL: 'glm-latest',
    });

    const result = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 8192,
    });

    expect(result).toMatchObject({
      output: '# Read\n\n## Brief\n\nx',
      exitCode: 0,
      finishReason: 'stop',
    });
    expect(state.lastClientOptions).toMatchObject({
      apiKey: 'token',
      baseURL: 'https://example.test/v1',
      maxRetries: 0,
    });
    expect(state.lastRequest).toMatchObject({
      model: 'glm-latest',
      max_tokens: 8192,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USR' },
      ],
    });
  });

  it('respects timeoutMs on the request and disables SDK retries', async () => {
    state.createImpl = null;
    const adapter = new OpenAITextAdapter(env());

    await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      timeoutMs: 45_000,
      maxTokens: 1024,
    });

    expect(state.lastClientOptions).toMatchObject({ maxRetries: 0 });
    expect(state.lastRequestOptions).toMatchObject({ timeout: 45_000, maxRetries: 0 });
  });

  it('maps timeout/abort errors to a non-zero InvokeResult instead of throwing', async () => {
    state.createImpl = async () => {
      const err = new Error('Request was aborted.');
      err.name = 'AbortError';
      throw err;
    };
    const adapter = new OpenAITextAdapter(env());

    const result = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      timeoutMs: 1_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/abort|timeout/i);
  });

  it('omits thinking and retries once when the model rejects thinking.disabled', async () => {
    let calls = 0;
    state.createImpl = async () => {
      calls += 1;
      if (calls === 1) throw thinkingUnsupportedError();
      return {
        choices: [{ message: { content: '# Read\n\n## Brief\n\nok' }, finish_reason: 'stop' }],
      };
    };
    const adapter = new OpenAITextAdapter({
      ...env(),
      VOLCENGINE_MODEL: 'glm-latest',
    });

    const result = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });

    expect(result).toMatchObject({
      output: '# Read\n\n## Brief\n\nok',
      exitCode: 0,
      finishReason: 'stop',
    });
    expect(calls).toBe(2);
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0]).toMatchObject({ thinking: { type: 'disabled' } });
    expect(state.requests[1]).not.toHaveProperty('thinking');
  });

  it('does not retry unrelated 400 errors', async () => {
    let calls = 0;
    state.createImpl = async () => {
      calls += 1;
      throw Object.assign(new Error('400 context_length_exceeded'), { status: 400 });
    };
    const adapter = new OpenAITextAdapter(env());

    const result = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toBe(1);
    expect(state.requests).toHaveLength(1);
    expect(result.stderr).toMatch(/context_length_exceeded/);
  });

  it('omits thinking on later invokes after the model rejected it', async () => {
    let calls = 0;
    state.createImpl = async () => {
      calls += 1;
      if (calls === 1) throw thinkingUnsupportedError();
      return {
        choices: [{ message: { content: `ok-${calls}` }, finish_reason: 'stop' }],
      };
    };
    const adapter = new OpenAITextAdapter({
      ...env(),
      RESEARCHER_LIBRARY_READ_MODEL: 'coding-glm-latest',
    });

    const first = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });
    const second = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(calls).toBe(3);
    expect(state.requests).toHaveLength(3);
    expect(state.requests[0]).toMatchObject({ thinking: { type: 'disabled' } });
    expect(state.requests[1]).not.toHaveProperty('thinking');
    expect(state.requests[2]).not.toHaveProperty('thinking');
  });

  it('remembers thinking-unsupported in-process for new adapters', async () => {
    let calls = 0;
    state.createImpl = async () => {
      calls += 1;
      if (calls === 1) throw thinkingUnsupportedError();
      return {
        choices: [{ message: { content: `ok-${calls}` }, finish_reason: 'stop' }],
      };
    };

    const first = new OpenAITextAdapter({
      ...env(),
      RESEARCHER_LIBRARY_READ_MODEL: 'coding-glm-latest',
    });
    const firstResult = await first.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });
    expect(firstResult.exitCode).toBe(0);

    state.requests = [];
    const second = new OpenAITextAdapter({
      ...env(),
      RESEARCHER_LIBRARY_READ_MODEL: 'coding-glm-latest',
    });
    const secondResult = await second.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });

    expect(secondResult.exitCode).toBe(0);
    expect(calls).toBe(3);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).not.toHaveProperty('thinking');
  });

  it('does not reuse thinking-unsupported memory across different models', async () => {
    let calls = 0;
    state.createImpl = async () => {
      calls += 1;
      if (calls === 1) throw thinkingUnsupportedError();
      return {
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      };
    };

    await new OpenAITextAdapter({
      ...env(),
      RESEARCHER_LIBRARY_READ_MODEL: 'coding-glm-latest',
    }).invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });

    state.requests = [];
    await new OpenAITextAdapter({
      ...env(),
      RESEARCHER_LIBRARY_READ_MODEL: 'glm-latest',
    }).invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      maxTokens: 1024,
    });

    expect(state.requests[0]).toMatchObject({ thinking: { type: 'disabled' } });
  });
});
