import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadPromptTemplate } from '../../src/prompts/load.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('stage-synthesize paper tables', () => {
  it('requires README and papers/README tables newest-first without renumbering', () => {
    const tpl = loadPromptTemplate('stage-synthesize.md');
    expect(tpl).toMatch(/newest-first|最新在上/);
    expect(tpl).toMatch(/papers\/README\.md/);
    expect(tpl.toLowerCase()).toMatch(/note (number|id|#)|笔记编号/);

    const writing = readFileSync(join(repoRoot, 'methodology/06-writing.md'), 'utf8');
    expect(writing).toMatch(/newest-first|最新在上/);
  });
});
