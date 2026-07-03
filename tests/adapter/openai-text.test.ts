import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  lastClientOptions: undefined as unknown,
  lastRequest: undefined as unknown,
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((options: unknown) => {
    state.lastClientOptions = options;
    return {
      chat: {
        completions: {
          create: vi.fn(async (request: unknown) => {
            state.lastRequest = request;
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
});
