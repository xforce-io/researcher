import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  arxivCacheDir,
  readJsonCache,
  writeJsonCache,
  readTextCache,
  writeTextCache,
} from '../../src/sources/cache.js';

describe('arxiv cache', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-cache-'));
    process.env.RESEARCHER_HOME = home;
  });

  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('puts cache under <RESEARCHER_HOME>/cache/arxiv', () => {
    expect(arxivCacheDir()).toBe(join(home, 'cache', 'arxiv'));
  });

  it('returns undefined on miss', () => {
    expect(readJsonCache('2401.12345')).toBeUndefined();
    expect(readTextCache('2401.12345')).toBeUndefined();
  });

  it('round-trips JSON', () => {
    const value = { id: 'arxiv:2401.12345', title: 'X', authors: ['A'], abstract: 'a' };
    writeJsonCache('2401.12345', value);
    expect(readJsonCache('2401.12345')).toEqual(value);
  });

  it('round-trips text', () => {
    writeTextCache('2401.12345', 'paper body\n');
    expect(readTextCache('2401.12345')).toBe('paper body\n');
  });

  it('writes atomically (no partial file visible after a write)', () => {
    writeTextCache('2401.12345', 'first');
    writeTextCache('2401.12345', 'second');
    expect(readTextCache('2401.12345')).toBe('second');
  });

  it('treats unparseable JSON as miss (does not throw)', () => {
    mkdirSync(arxivCacheDir(), { recursive: true });
    writeFileSync(join(arxivCacheDir(), '2401.12345.meta.json'), '{not valid json');
    expect(readJsonCache('2401.12345')).toBeUndefined();
  });

  it('persists files at the documented path layout', () => {
    writeTextCache('2401.12345', 'hello');
    writeJsonCache('2401.12345', { ok: true });
    expect(readFileSync(join(arxivCacheDir(), '2401.12345.txt'), 'utf8')).toBe('hello');
    expect(JSON.parse(readFileSync(join(arxivCacheDir(), '2401.12345.meta.json'), 'utf8')))
      .toEqual({ ok: true });
  });
});
