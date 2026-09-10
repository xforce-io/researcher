import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runLibraryAdd, runLibraryIntegrate, runLibraryLink, runLibraryList, runLibraryUnlink } from '../../src/commands/library.js';
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
    const added = runLibraryAdd({ cwd: root, input: 'https://arxiv.org/abs/2401.12345v2', tags: ['survey'], write });
    runLibraryAdd({ cwd: root, input: '2401.12345', tags: ['benchmark'], write });
    runLibraryLink({ cwd: root, paperId: added.id, topic: 'trace', rationale: 'matches RQ1', write });

    const lib = new PaperLibrary(root);
    expect(lib.listPapers()).toEqual([
      expect.objectContaining({ id: added.id, tags: ['benchmark'] }),
    ]);
    expect(lib.listLinks(added.id)).toEqual([
      expect.objectContaining({ paperId: added.id, surfaceType: 'topic', surfaceId: 'trace', rationale: 'matches RQ1' }),
    ]);
    expect(lib.listDocuments()).toHaveLength(1);
    expect(readFileSync(join(root, 'trace/notes/00_research_landscape.md'), 'utf8')).toBe('# Landscape\n');
    expect(readFileSync(join(root, 'trace/report.md'), 'utf8')).toBe('# Report\n');
  });

  it('prints library papers', () => {
    runLibraryAdd({ cwd: root, input: 'https://example.com/paper', tags: [], write: () => {} });
    const out: string[] = [];
    runLibraryList({ cwd: root, write: (s) => out.push(s) });
    expect(out.join('')).toContain('url:https://example.com/paper');
    expect(out.join('')).toMatch(/paper_url_[a-f0-9]{16}/);
    expect(existsSync(join(root, '.researcher-workspace/library/schema.json'))).toBe(true);
  });

  it('records topic integration without mutating topic artifacts', () => {
    const write = (_s: string) => {};
    const added = runLibraryAdd({ cwd: root, input: '2401.12345', write });
    runLibraryIntegrate({
      cwd: root,
      paperId: added.id,
      topic: 'trace',
      notePath: 'trace/notes/active/01_stub.md',
      zone: 'active',
      summary: 'answers RQ1',
      write,
    });

    const lib = new PaperLibrary(root);
    expect(lib.listIntegrations(added.id)).toEqual([
      expect.objectContaining({
        paperId: added.id,
        topicId: 'trace',
        notePath: 'trace/notes/active/01_stub.md',
        zone: 'active',
        summary: 'answers RQ1',
      }),
    ]);
    expect(lib.listLinks(added.id)).toEqual([
      expect.objectContaining({ surfaceType: 'topic', surfaceId: 'trace' }),
    ]);
    expect(readFileSync(join(root, 'trace/notes/00_research_landscape.md'), 'utf8')).toBe('# Landscape\n');
    expect(readFileSync(join(root, 'trace/report.md'), 'utf8')).toBe('# Report\n');
  });

  it('unlinks a paper from one topic without removing its integration history', () => {
    const write = (_s: string) => {};
    const added = runLibraryAdd({ cwd: root, input: '2401.12345', write });
    runLibraryLink({ cwd: root, paperId: added.id, topic: 'trace', write });
    runLibraryUnlink({ cwd: root, paperId: added.id, topic: 'trace', write });
    expect(new PaperLibrary(root).listLinks(added.id)).toEqual([]);
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
