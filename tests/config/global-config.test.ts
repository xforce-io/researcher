import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalConfig } from '../../src/config/global-config.js';

describe('loadGlobalConfig', () => {
  it('returns defaults when file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    const cfg = loadGlobalConfig(join(dir, 'config.yaml'));
    expect(cfg.runtime).toBe('claude-code');
  });
  it('reads runtime override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    const p = join(dir, 'config.yaml');
    writeFileSync(p, 'runtime: claude-code\n');
    expect(loadGlobalConfig(p).runtime).toBe('claude-code');
  });
});
