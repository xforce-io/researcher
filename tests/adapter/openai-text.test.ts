import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  lastClientOptions: undefined as unknown,
  lastRequest: undefined as unknown,
  lastRequestOptions: undefined as unknown,
  createImpl: null as null | ((request: unknown, options?: unknown) => Promise<unknown>),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options: unknown) => {
    state.lastClientOptions = options;
    return {
      chat: {
        completions: {
          create: vi.fn(async (request: unknown, requestOptions?: unknown) => {
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

import { OpenAITextAdapter } from '../../src/adapter/openai-text.js';

describe('OpenAITextAdapter', () => {
  it('passes max_tokens and returns text content', async () => {
    state.createImpl = null;
    const adapter = new OpenAITextAdapter({
      VOLCENGINE_TOKEN: 'token',
      VOLCENGINE_API_BASE: 'https://example.test/v1',
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
    const adapter = new OpenAITextAdapter({
      VOLCENGINE_TOKEN: 'token',
      VOLCENGINE_API_BASE: 'https://example.test/v1',
    });

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
    const adapter = new OpenAITextAdapter({
      VOLCENGINE_TOKEN: 'token',
      VOLCENGINE_API_BASE: 'https://example.test/v1',
    });

    const result = await adapter.invoke({
      cwd: '/tmp/x',
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      timeoutMs: 1_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/abort|timeout/i);
  });
});
