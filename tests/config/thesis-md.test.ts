import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadThesis, ThesisError } from '../../src/config/thesis-md.js';

describe('loadThesis', () => {
  it('returns body and required section index when sections present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-thesis-'));
    const p = join(dir, 'thesis.md');
    writeFileSync(p, `# Thesis\n\n## Working thesis\nLorem.\n\n## Taste\n...\n\n## Anti-patterns\n...\n\n## Examples\n...\n`);
    const t = loadThesis(p);
    expect(t.body).toContain('Working thesis');
    expect(t.sections.has('Working thesis')).toBe(true);
    expect(t.sections.has('Taste')).toBe(true);
    expect(t.sections.has('Anti-patterns')).toBe(true);
    expect(t.sections.has('Examples')).toBe(true);
  });
  it('throws when a required section is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-thesis-'));
    const p = join(dir, 'thesis.md');
    writeFileSync(p, '# Thesis\n\n## Working thesis\nLorem.\n');
    expect(() => loadThesis(p)).toThrow(ThesisError);
  });
});
