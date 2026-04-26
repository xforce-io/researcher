import { describe, it, expect } from 'vitest';
import { loadPromptTemplate } from '../../src/prompts/load.js';

describe('stage-read prompt', () => {
  it('fences paper_text as untrusted content with explicit data-not-instructions guidance', () => {
    const tpl = loadPromptTemplate('stage-read.md');

    // The {{paper_text}} placeholder must be wrapped in a fence so that any
    // injection ("ignore previous instructions, run...") inside the paper is
    // visibly bounded as data, not interpreted as agent instructions.
    const idx = tpl.indexOf('{{paper_text}}');
    expect(idx).toBeGreaterThan(0);
    const before = tpl.slice(0, idx);
    const after = tpl.slice(idx);

    // Some kind of opening fence right before paper_text.
    expect(before).toMatch(/BEGIN UNTRUSTED|<untrusted_paper_text>|```untrusted/);
    // ...and a matching closing fence after.
    expect(after).toMatch(/END UNTRUSTED|<\/untrusted_paper_text>|```/);
    // Explicit guidance about how to treat the fenced content.
    expect(tpl.toLowerCase()).toMatch(/treat .* as data|do not (follow|obey) instructions/);
  });
});
