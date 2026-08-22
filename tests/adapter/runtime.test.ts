import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/adapter/runtime.js';
import { AgentConnectionError } from '../../src/config/agent-connection.js';

describe('createAgentRuntime', () => {
  it('uses Milkie when the runtime is not configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'researcher-runtime-'));

    expect(createAgentRuntime(home).id).toBe('milkie');
  });

  it('creates the Grok CLI runtime from legacy global configuration', () => {
    const home = mkdtempSync(join(tmpdir(), 'researcher-runtime-'));
    writeFileSync(
      join(home, 'config.yaml'),
      'runtime: grok-cli\nruntime_options:\n  grok-cli:\n    bin: /tmp/grok\n    model: custom\n',
    );

    expect(createAgentRuntime(home).id).toBe('grok-cli');
  });

  it('creates the Grok CLI runtime from canonical agent-cli configuration', () => {
    const home = mkdtempSync(join(tmpdir(), 'researcher-runtime-'));
    writeFileSync(
      join(home, 'config.yaml'),
      'transport: agent-cli\nruntime: grok-cli\nruntime_options:\n  grok-cli:\n    bin: /tmp/grok\n    model: custom\n',
    );

    expect(createAgentRuntime(home).id).toBe('grok-cli');
  });

  it('rejects transport=api before constructing an adapter', () => {
    const home = mkdtempSync(join(tmpdir(), 'researcher-runtime-'));
    writeFileSync(
      join(home, 'config.yaml'),
      [
        'transport: api',
        'protocol: openai-chat-completions',
        'model: glm-latest',
        'apiKey: secret',
      ].join('\n'),
    );

    expect(() => createAgentRuntime(home)).toThrow(AgentConnectionError);
  });
});
