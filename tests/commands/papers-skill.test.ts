import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('skills/papers/SKILL.md', () => {
  const md = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../skills/papers/SKILL.md'),
    'utf8',
  );

  it('documents the four papers subcommands and forbids the old fetcher', () => {
    expect(md).toContain('researcher papers trending');
    expect(md).toContain('researcher papers search');
    expect(md).toContain('researcher papers show');
    expect(md).toContain('researcher papers read');
    expect(md).not.toContain('fetch_papers.py');
    expect(md).toMatch(/do \*\*not\*\* curl\/wget/i);
  });
});
