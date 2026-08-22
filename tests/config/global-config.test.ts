import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalConfig } from '../../src/config/global-config.js';

describe('loadGlobalConfig', () => {
  it('returns grok-cli option defaults when the file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    expect(loadGlobalConfig(join(dir, 'config.yaml'))).toMatchObject({
      runtime_options: { 'grok-cli': { bin: 'grok', model: 'grok-4.5' } },
    });
  });
  it('reads Grok runtime and options overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    const p = join(dir, 'config.yaml');
    writeFileSync(
      p,
      'runtime: grok-cli\nruntime_options:\n  grok-cli:\n    bin: /tmp/grok\n    model: custom\n',
    );
    expect(loadGlobalConfig(p)).toMatchObject({
      runtime: 'grok-cli',
      runtime_options: { 'grok-cli': { bin: '/tmp/grok', model: 'custom' } },
    });
  });
  it('reads canonical transport and runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    const p = join(dir, 'config.yaml');
    writeFileSync(p, 'transport: agent-cli\nruntime: grok-cli\n');
    expect(loadGlobalConfig(p)).toMatchObject({
      transport: 'agent-cli',
      runtime: 'grok-cli',
    });
  });
});
