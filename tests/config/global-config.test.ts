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
  it('defaults urlExtract thresholds and reads overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    expect(loadGlobalConfig(join(dir, 'config.yaml')).urlExtract).toEqual({ minChars: 1000, minWords: 150 });
    writeFileSync(join(dir, 'config.yaml'), 'urlExtract:\n  minChars: 800\n  minWords: 120\n');
    expect(loadGlobalConfig(join(dir, 'config.yaml')).urlExtract).toEqual({ minChars: 800, minWords: 120 });
  });
});
