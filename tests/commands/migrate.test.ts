import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backfillLibraryFromTopicNotes, migrateFlatNotesInTopic } from '../../src/commands/migrate.js';
import { parseNote } from '../../src/state/zone.js';
import { PaperLibrary } from '../../src/library/store.js';

describe('migrateFlatNotesInTopic', () => {
  it('moves flat numbered notes into notes/active and adds active frontmatter', () => {
    const proj = mkdtempSync(join(tmpdir(), 'r-migrate-'));
    mkdirSync(join(proj, '.researcher'), { recursive: true });
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Landscape');
    writeFileSync(join(proj, 'notes/01_old.md'), '# Old\n\n## Claims\n- x');

    const res = migrateFlatNotesInTopic(proj);
    expect(res.moved).toEqual(['notes/01_old.md -> notes/active/01_old.md']);
    expect(existsSync(join(proj, 'notes/01_old.md'))).toBe(false);
    const migrated = readFileSync(join(proj, 'notes/active/01_old.md'), 'utf8');
    expect(parseNote(migrated).fm.zone).toBe('active');
    expect(migrated).toContain('# Old');
    expect(existsSync(join(proj, 'notes/00_research_landscape.md'))).toBe(true);
  });

  it('preserves existing non-standard frontmatter while injecting zone fields', () => {
    const proj = mkdtempSync(join(tmpdir(), 'r-migrate-'));
    mkdirSync(join(proj, '.researcher'), { recursive: true });
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/14_old.md'), '---\npaper: Autodata: an automatic data scientist to collaborate with humans\nyear: 2026\n---\n# Old');

    migrateFlatNotesInTopic(proj);
    const migrated = readFileSync(join(proj, 'notes/active/14_old.md'), 'utf8');
    expect(migrated).toContain('zone: active');
    expect(migrated).toContain('paper: Autodata: an automatic data scientist to collaborate with humans');
    expect(migrated).toContain('year: 2026');
  });
});

describe('backfillLibraryFromTopicNotes', () => {
  it('imports source-bearing historical topic notes into Library links and integrations idempotently', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-lib-backfill-'));
    const trace = join(root, 'trace');
    const decision = join(root, 'decision');
    mkdirSync(join(trace, '.researcher'), { recursive: true });
    mkdirSync(join(decision, '.researcher'), { recursive: true });
    mkdirSync(join(trace, 'notes/active'), { recursive: true });
    mkdirSync(join(trace, 'notes/buffer'), { recursive: true });
    mkdirSync(join(decision, 'notes/history'), { recursive: true });
    writeFileSync(join(root, 'researcher.workspace.yml'),
      'version: 1\n' +
      'topics:\n' +
      '  - { path: trace, active: true }\n' +
      '  - { path: decision, active: true }\n',
    );
    writeFileSync(join(trace, 'notes/active/01_frontmatter.md'),
      '---\nzone: active\narxiv: "2604.00356"\ntitle: "Signals"\n---\n# Signals\n',
    );
    writeFileSync(join(trace, 'notes/buffer/02_link.md'),
      '---\nzone: buffer\n---\n# AgentHER\n\n> **arXiv:** [2603.21357](https://arxiv.org/abs/2603.21357)\n',
    );
    writeFileSync(join(decision, 'notes/history/03_url.md'),
      '---\nzone: history\nurl: https://example.com/paper\npaper: URL Paper\n---\n# URL Paper\n',
    );

    const first = backfillLibraryFromTopicNotes(root);
    const second = backfillLibraryFromTopicNotes(root);

    expect(first.importedPapers).toBe(3);
    expect(first.importedReads).toBe(3);
    expect(second.importedPapers).toBe(0);
    expect(second.importedReads).toBe(0);
    const lib = new PaperLibrary(root);
    expect(lib.listPapers().map((p) => p.canonicalSource.id).sort()).toEqual([
      'arxiv:2603.21357',
      'arxiv:2604.00356',
      'url:https://example.com/paper',
    ]);
    expect(lib.listLinks()).toHaveLength(3);
    expect(lib.listIntegrations()).toHaveLength(3);
    expect(lib.listReads()).toHaveLength(3);
    expect(lib.listReads().every((r) => r.status === 'read' && r.artifactPath)).toBe(true);
    const artifact = readFileSync(join(root, lib.listReads('paper_arxiv_2604_00356')[0].artifactPath!), 'utf8');
    expect(artifact).toContain('kind: legacy-topic-read');
    expect(artifact).toContain('source_note: "notes/active/01_frontmatter.md"');
    expect(lib.listIntegrations().find((i) => i.paperId === 'paper_arxiv_2604_00356')).toMatchObject({
      topicId: 'trace',
      notePath: 'notes/active/01_frontmatter.md',
      zone: 'active',
    });
  });
});
