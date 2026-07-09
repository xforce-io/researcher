import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaperLibrary } from '../../src/library/store.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';
import { runLibraryAdd, runLibraryDelete, runLibraryLink } from '../../src/commands/library.js';

describe('PaperLibrary.deletePaper', () => {
  it('removes an unlinked paper, its reads, and artifact directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-del-'));
    const lib = new PaperLibrary(root, { now: () => '2026-07-09T00:00:00.000Z' });
    const source = normalizePaperInput('https://example.com/doc');
    const id = paperIdForSource(source);
    lib.upsertPaper({
      id,
      canonicalSource: source,
      sources: [source],
      identifiers: { url: 'https://example.com/doc' },
      tags: [],
    });
    const artifactPath = `.researcher-workspace/library/papers/${id}/reads/read_${id}.md`;
    mkdirSync(join(root, `.researcher-workspace/library/papers/${id}/reads`), { recursive: true });
    writeFileSync(join(root, artifactPath), '# note\n');
    lib.upsertRead({ id: `read_${id}`, paperId: id, status: 'read', artifactPath });

    const result = lib.deletePaper(id);

    expect(result.deleted).toBe(true);
    expect(lib.getPaper(id)).toBeUndefined();
    expect(lib.listReads(id)).toEqual([]);
    expect(existsSync(join(root, `.researcher-workspace/library/papers/${id}`))).toBe(false);
    expect(readFileSync(join(root, '.researcher-workspace/library/papers.jsonl'), 'utf8').trim()).toBe('');
  });

  it('refuses to delete a paper that is linked to a topic', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-del-'));
    const lib = new PaperLibrary(root, { now: () => '2026-07-09T00:00:00.000Z' });
    const source = normalizePaperInput('2401.12345');
    const id = paperIdForSource(source);
    lib.upsertPaper({
      id,
      canonicalSource: source,
      sources: [source],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
    });
    lib.upsertLink({
      paperId: id,
      surfaceType: 'topic',
      surfaceId: 'trace',
      relation: 'candidate',
    });

    expect(() => lib.deletePaper(id)).toThrow(/linked|unlink/i);
    expect(lib.getPaper(id)?.id).toBe(id);
  });

  it('refuses to delete a paper with topic integrations even if links were cleared inconsistently', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-del-'));
    const lib = new PaperLibrary(root, { now: () => '2026-07-09T00:00:00.000Z' });
    const source = normalizePaperInput('2401.99999');
    const id = paperIdForSource(source);
    lib.upsertPaper({
      id,
      canonicalSource: source,
      sources: [source],
      identifiers: { arxiv: '2401.99999' },
      tags: [],
    });
    lib.upsertIntegration({
      paperId: id,
      topicId: 'trace',
      integratedAt: '2026-07-09T00:00:00.000Z',
    });

    expect(() => lib.deletePaper(id)).toThrow(/integrat/i);
    expect(lib.getPaper(id)?.id).toBe(id);
  });
});

describe('runLibraryDelete', () => {
  it('deletes via CLI helper only when unlinked', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-del-cmd-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: trace, active: true }\n');
    mkdirSync(join(root, 'trace'), { recursive: true });
    const write = () => {};
    runLibraryAdd({ cwd: root, input: 'https://example.com/x', write });
    const id = paperIdForSource(normalizePaperInput('https://example.com/x'));

    runLibraryDelete({ cwd: root, paperId: id, write });
    expect(new PaperLibrary(root).getPaper(id)).toBeUndefined();

    runLibraryAdd({ cwd: root, input: '2401.12345', write });
    runLibraryLink({ cwd: root, paperId: 'paper_arxiv_2401_12345', topic: 'trace', write });
    expect(() => runLibraryDelete({ cwd: root, paperId: 'paper_arxiv_2401_12345', write })).toThrow(/linked/i);
  });
});
