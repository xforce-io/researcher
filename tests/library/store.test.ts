import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaperLibrary } from '../../src/library/store.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';

describe('PaperLibrary store', () => {
  it('upserts papers by id without duplicating records', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-'));
    const lib = new PaperLibrary(root, { now: () => '2026-07-02T00:00:00.000Z' });
    const source = normalizePaperInput('2401.12345v2');
    const id = paperIdForSource(source);

    lib.upsertPaper({ id, canonicalSource: source, sources: [source], identifiers: { arxiv: '2401.12345' }, tags: ['survey'] });
    lib.upsertPaper({ id, canonicalSource: source, sources: [source], identifiers: { arxiv: '2401.12345' }, tags: ['benchmark'] });

    expect(lib.listPapers()).toHaveLength(1);
    expect(lib.getPaper(id)?.tags).toEqual(['benchmark']);
    expect(readFileSync(join(root, '.researcher-workspace/library/papers.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('stores reads and paper-surface links separately from paper tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-'));
    const lib = new PaperLibrary(root, { now: () => '2026-07-02T00:00:00.000Z' });
    const source = normalizePaperInput('https://example.com/x');
    const id = paperIdForSource(source);
    lib.upsertPaper({ id, canonicalSource: source, sources: [source], identifiers: { url: 'https://example.com/x' }, tags: ['agent-memory'] });
    lib.upsertRead({ id: `read_${id}`, paperId: id, status: 'read', artifactPath: `.researcher-workspace/library/papers/${id}/read.md` });
    lib.upsertLink({ paperId: id, surfaceType: 'topic', surfaceId: 'trace', relation: 'candidate', rationale: 'matches RQ1' });

    expect(lib.getPaper(id)?.tags).toEqual(['agent-memory']);
    expect(lib.listReads(id)).toEqual([
      expect.objectContaining({ id: `read_${id}`, paperId: id, status: 'read' }),
    ]);
    expect(lib.listLinks(id)).toEqual([
      expect.objectContaining({ paperId: id, surfaceType: 'topic', surfaceId: 'trace', relation: 'candidate' }),
    ]);
    expect(existsSync(join(root, '.researcher-workspace/library/reads.jsonl'))).toBe(true);
    expect(existsSync(join(root, '.researcher-workspace/library/links.jsonl'))).toBe(true);
  });
});
