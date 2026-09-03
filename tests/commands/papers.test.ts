import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPapersRead, runPapersSearch, runPapersShow, runPapersTrending } from '../../src/commands/papers.js';
import { PaperLibrary, LIBRARY_DIR } from '../../src/library/store.js';
import { PAPER_READ_SECTIONS } from '../../src/web/library-read-sections.js';
import type { LibraryReadRunner } from '../../src/web/library-read.js';
import type { PapersItem } from '../../src/sources/papers-radar.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    write: (s: string) => out.push(s),
    writeErr: (s: string) => err.push(s),
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'r-papers-ws-'));
  writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
  return root;
}

const cardBody = ['> frame', ...PAPER_READ_SECTIONS.map((s) => `## ${s}\ntext`)].join('\n\n');

describe('runPapersTrending', () => {
  it('prints only JSON on stdout and caps limit', async () => {
    const io = capture();
    await runPapersTrending({
      limit: 10,
      format: 'json',
      write: io.write,
      writeErr: io.writeErr,
      fetch: async () =>
        jsonResponse([
          {
            paper: {
              id: '2401.12345',
              title: 'Sample Paper',
              authors: [{ name: 'Ada' }],
              summary: 'A useful abstract.',
              publishedAt: '2026-01-15T00:00:00.000Z',
              upvotes: 10,
            },
          },
        ]),
    });
    const parsed = JSON.parse(io.stdout()) as PapersItem[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('arxiv:2401.12345');
    expect(parsed[0].title).toBe('Sample Paper');
    expect(io.stderr()).not.toMatch(/^\s*\[/);
  });

  it('prints a Chinese report when format=report', async () => {
    const io = capture();
    await runPapersTrending({
      format: 'report',
      write: io.write,
      fetch: async () =>
        jsonResponse([
          {
            paper: {
              id: '2401.12345',
              title: 'Sample Paper',
              authors: [{ name: 'Ada' }],
              summary: 'A useful abstract.',
              publishedAt: '2026-01-15T00:00:00.000Z',
              upvotes: 10,
            },
          },
        ]),
    });
    expect(io.stdout()).toContain('今日 AI 论文热榜');
    expect(io.stdout()).toContain('Sample Paper');
    expect(io.stdout()).toContain('https://arxiv.org/abs/2401.12345');
  });
});

describe('runPapersSearch / show', () => {
  it('search writes JSON metadata', async () => {
    const io = capture();
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/2501.00009v1</id>
        <title>SkillCraft</title>
        <summary>About skills.</summary>
        <published>2026-02-01T00:00:00Z</published>
        <author><name>Ada</name></author>
      </entry>
    </feed>`;
    await runPapersSearch({
      query: 'SkillCraft',
      format: 'json',
      write: io.write,
      fetch: async () => new Response(atom, { status: 200 }),
    });
    const parsed = JSON.parse(io.stdout()) as PapersItem[];
    expect(parsed[0].title).toBe('SkillCraft');
    expect(parsed[0].abstract).toContain('About skills');
    expect(parsed[0].arxiv_url).toContain('2501.00009');
  });

  it('show throws on unknown id without writing JSON', async () => {
    const io = capture();
    await expect(
      runPapersShow({
        arxivId: '2401.00000',
        write: io.write,
        fetch: async () => jsonResponse({}, 404),
      }),
    ).rejects.toThrow(/not found/i);
    expect(io.stdout()).toBe('');
  });
});

describe('runPapersRead', () => {
  it('writes a Library evidence card to the default workspace and prints it', async () => {
    const root = makeWorkspace();
    const io = capture();
    let ran = 0;
    const runner: LibraryReadRunner = async ({ workspaceRoot, paper, readId }) => {
      ran += 1;
      const artifactPath = `${LIBRARY_DIR}/papers/${paper.id}/reads/${readId}.md`;
      mkdirSync(join(workspaceRoot, LIBRARY_DIR, 'papers', paper.id, 'reads'), { recursive: true });
      writeFileSync(
        join(workspaceRoot, artifactPath),
        `---\nkind: library-read\npaper_id: "${paper.id}"\n---\n\n${cardBody}\n`,
      );
      return { artifactPath, title: 'Sample Paper' };
    };
    await runPapersRead({
      input: '2401.12345',
      workspace: root,
      write: io.write,
      writeErr: io.writeErr,
      runner,
    });
    expect(ran).toBe(1);
    const lib = new PaperLibrary(root);
    const paper = lib.getPaper('paper_arxiv_2401_12345');
    expect(paper).toBeTruthy();
    const reads = lib.listReads(paper!.id);
    expect(reads[0].status).toBe('read');
    expect(reads[0].artifactPath).toBeTruthy();
    expect(io.stdout()).toContain('## Essence');
    expect(io.stdout()).toContain('## Takeaway');
    expect(io.stderr()).toMatch(/library-read:/);

    await runPapersRead({
      input: '2401.12345',
      workspace: root,
      write: io.write,
      writeErr: io.writeErr,
      runner,
    });
    expect(ran).toBe(1);
  });

  it('reclaims a stale reading record and runs the reader', async () => {
    const root = makeWorkspace();
    const lib = new PaperLibrary(root);
    lib.upsertPaper({
      id: 'paper_arxiv_2401_12345',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345' }],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
    });
    lib.upsertRead({ id: 'read_paper_arxiv_2401_12345', paperId: 'paper_arxiv_2401_12345', status: 'reading' });
    const io = capture();
    let ran = 0;
    const runner: LibraryReadRunner = async ({ workspaceRoot, paper, readId }) => {
      ran += 1;
      const artifactPath = `${LIBRARY_DIR}/papers/${paper.id}/reads/${readId}.md`;
      mkdirSync(join(workspaceRoot, LIBRARY_DIR, 'papers', paper.id, 'reads'), { recursive: true });
      writeFileSync(join(workspaceRoot, artifactPath), `---\nkind: library-read\n---\n\n${cardBody}\n`);
      return { artifactPath, title: 'Sample Paper' };
    };
    await runPapersRead({
      input: '2401.12345',
      workspace: root,
      write: io.write,
      writeErr: io.writeErr,
      runner,
    });
    expect(ran).toBe(1);
    expect(io.stderr()).toMatch(/reclaimed/i);
    expect(new PaperLibrary(root).listReads('paper_arxiv_2401_12345')[0].status).toBe('read');
  });

  it('does not write files when no default workspace is configured', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'r-papers-nows-'));
    const home = mkdtempSync(join(tmpdir(), 'r-home-'));
    await expect(
      runPapersRead({
        input: '2401.12345',
        home,
        env: {},
        runner: async () => {
          throw new Error('runner should not run');
        },
      }),
    ).rejects.toThrow(/default workspace/i);
    expect(existsSync(join(cwd, '.researcher-workspace'))).toBe(false);
    expect(existsSync(join(home, '.researcher-workspace'))).toBe(false);
  });
});
