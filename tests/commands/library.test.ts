import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { parseRelation, runLibraryAdd, runLibraryIntegrate, runLibraryLink, runLibraryList } from '../../src/commands/library.js';
import { PaperLibrary } from '../../src/library/store.js';

describe('researcher library commands', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'r-library-cmd-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: root });
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: trace, active: true }\n');
    mkdirSync(join(root, 'trace/notes'), { recursive: true });
    writeFileSync(join(root, 'trace/notes/00_research_landscape.md'), '# Landscape\n');
    writeFileSync(join(root, 'trace/report.md'), '# Report\n');
  });

  it('adds, lists, and links a paper without a topic .researcher directory', () => {
    const write = (_s: string) => {};
    runLibraryAdd({ cwd: root, input: 'https://arxiv.org/abs/2401.12345v2', tags: ['survey'], write });
    runLibraryAdd({ cwd: root, input: '2401.12345', tags: ['benchmark'], write });
    runLibraryLink({ cwd: root, paperId: 'paper_arxiv_2401_12345', topic: 'trace', relation: 'candidate', rationale: 'matches RQ1', write });

    const lib = new PaperLibrary(root);
    expect(lib.listPapers()).toEqual([
      expect.objectContaining({ id: 'paper_arxiv_2401_12345', tags: ['benchmark'] }),
    ]);
    expect(lib.listLinks('paper_arxiv_2401_12345')).toEqual([
      expect.objectContaining({ paperId: 'paper_arxiv_2401_12345', surfaceType: 'topic', surfaceId: 'trace', relation: 'candidate' }),
    ]);
    expect(readFileSync(join(root, '.researcher-workspace/library/papers.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(join(root, 'trace/notes/00_research_landscape.md'), 'utf8')).toBe('# Landscape\n');
    expect(readFileSync(join(root, 'trace/report.md'), 'utf8')).toBe('# Report\n');
  });

  it('prints library papers', () => {
    runLibraryAdd({ cwd: root, input: 'https://example.com/paper', tags: [], write: () => {} });
    const out: string[] = [];
    runLibraryList({ cwd: root, write: (s) => out.push(s) });
    expect(out.join('')).toContain('url:https://example.com/paper');
    expect(out.join('')).toMatch(/paper_url_[a-f0-9]{16}/);
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
  });

  it('records topic integration without mutating topic artifacts', () => {
    const write = (_s: string) => {};
    runLibraryAdd({ cwd: root, input: '2401.12345', write });
    runLibraryIntegrate({
      cwd: root,
      paperId: 'paper_arxiv_2401_12345',
      topic: 'trace',
      notePath: 'trace/notes/active/01_stub.md',
      zone: 'active',
      summary: 'answers RQ1',
      write,
    });

    const lib = new PaperLibrary(root);
    expect(lib.listIntegrations('paper_arxiv_2401_12345')).toEqual([
      expect.objectContaining({
        paperId: 'paper_arxiv_2401_12345',
        topicId: 'trace',
        notePath: 'trace/notes/active/01_stub.md',
        zone: 'active',
        summary: 'answers RQ1',
      }),
    ]);
    expect(lib.listLinks('paper_arxiv_2401_12345')).toEqual([
      expect.objectContaining({ surfaceType: 'topic', surfaceId: 'trace', relation: 'integrated' }),
    ]);
    expect(readFileSync(join(root, 'trace/notes/00_research_landscape.md'), 'utf8')).toBe('# Landscape\n');
    expect(readFileSync(join(root, 'trace/report.md'), 'utf8')).toBe('# Report\n');
  });

  it('validates paper relation input', () => {
    expect(parseRelation('relevant')).toBe('relevant');
    expect(() => parseRelation('maybe')).toThrow(/invalid relation/);
  });

  it('stores explicit docType on library add', () => {
    runLibraryAdd({
      cwd: root,
      input: 'https://example.com/design/cache',
      docType: 'design-doc',
      write: () => {},
    });
    const lib = new PaperLibrary(root);
    const paper = lib.listPapers()[0];
    expect(paper.docType).toBe('design-doc');
    expect(paper.canonicalSource.kind).toBe('url');
  });
});
