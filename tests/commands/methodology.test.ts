import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMethodologyInstall, runMethodologyShow } from '../../src/commands/methodology.js';

describe('methodology install', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-mhome-'));
    process.env.RESEARCHER_HOME = home;
  });
  it('copies all 7 methodology files into ~/.researcher/methodology', async () => {
    await runMethodologyInstall();
    const dir = join(home, 'methodology');
    for (const name of ['01-reading.md','02-source.md','03-filtering.md','04-synthesis.md','05-verification.md','06-writing.md','07-cadence.md']) {
      expect(existsSync(join(dir, name))).toBe(true);
      expect(readFileSync(join(dir, name), 'utf8').length).toBeGreaterThan(50);
    }
  });
});

describe('methodology show', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-mhome-'));
    process.env.RESEARCHER_HOME = home;
    mkdirSync(join(home, 'methodology'), { recursive: true });
    writeFileSync(join(home, 'methodology', 'x.md'), 'a\nb\nc');
  });
  it('lists files and line counts', async () => {
    const out = await runMethodologyShow();
    expect(out).toMatch(/x\.md\s+3/);
  });
});
