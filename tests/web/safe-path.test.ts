import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeDocPath, safePaperPath } from '../../src/web/safe-path.js';

let topic: string;
beforeAll(() => {
  topic = mkdtempSync(join(tmpdir(), 'rsw-safe-'));
  mkdirSync(join(topic, 'notes'), { recursive: true });
  mkdirSync(join(topic, 'papers'), { recursive: true });
  writeFileSync(join(topic, 'notes', '01_a.md'), '# a');
  writeFileSync(join(topic, 'papers', '2401.00001.pdf'), '%PDF');
});

describe('safeDocPath', () => {
  it('accepts an existing .md inside the topic', () => {
    expect(safeDocPath(topic, 'notes/01_a.md')).toBe(join(topic, 'notes/01_a.md'));
  });
  it('rejects traversal outside the topic', () => {
    expect(safeDocPath(topic, '../../etc/passwd')).toBeNull();
  });
  it('rejects non-.md files', () => {
    expect(safeDocPath(topic, 'papers/2401.00001.pdf')).toBeNull();
  });
  it('rejects a missing file', () => {
    expect(safeDocPath(topic, 'notes/zzz.md')).toBeNull();
  });
});

describe('safePaperPath', () => {
  it('accepts an existing pdf by id', () => {
    expect(safePaperPath(topic, '2401.00001')).toBe(join(topic, 'papers/2401.00001.pdf'));
  });
  it('rejects traversal in id', () => {
    expect(safePaperPath(topic, '../notes/01_a')).toBeNull();
  });
  it('rejects a missing pdf', () => {
    expect(safePaperPath(topic, 'nope')).toBeNull();
  });
});
