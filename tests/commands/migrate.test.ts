import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateFlatNotesInTopic } from '../../src/commands/migrate.js';
import { parseNote } from '../../src/state/zone.js';

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
