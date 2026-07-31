import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/adapter/runtime.js';

describe('createAgentRuntime', () => {
  it('uses Milkie when the runtime is not configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'researcher-runtime-'));

    expect(createAgentRuntime(home).id).toBe('milkie');
  });

  it('creates the Grok CLI runtime from global configuration', () => {
    const home = mkdtempSync(join(tmpdir(), 'researcher-runtime-'));
    writeFileSync(
      join(home, 'config.yaml'),
      'runtime: grok-cli\nruntime_options:\n  grok-cli:\n    bin: /tmp/grok\n    model: custom\n',
    );

    expect(createAgentRuntime(home).id).toBe('grok-cli');
  });
});
