import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  displayLibraryReadMarkdown,
  firstScreenSection,
  libraryReadBodyHasRequiredSections,
  PAPER_READ_SECTIONS,
  requiredPaperReadSections,
} from '../../src/web/library-read-sections.js';
import { renderLibraryPaper } from '../../src/web/views.js';
import type { LibraryPaperDetailView } from '../../src/web/discovery.js';

const PROMPTS = join(process.cwd(), 'prompts');

describe('library-read section contract (Essence replaces Brief)', () => {
  it('requires Essence (not Brief) in the paper read body structure', () => {
    const sections = requiredPaperReadSections();
    expect(sections[0]).toBe('Essence');
    expect(sections).not.toContain('Brief');
    expect(sections.indexOf('Essence')).toBeLessThan(sections.indexOf('Claims'));
  });

  it('stage-library-read prompt mandates Essence quality bar and omits Brief as required section', () => {
    const prompt = readFileSync(join(PROMPTS, 'stage-library-read.md'), 'utf8');
    // Structure block must list Essence before Claims, not Brief.
    const structure = prompt.match(/```markdown\n([\s\S]*?)```/)?.[1] ?? '';
    expect(structure).toContain('## Essence');
    expect(structure).not.toContain('## Brief');
    expect(structure.indexOf('## Essence')).toBeLessThan(structure.indexOf('## Claims'));
    // Quality bar documents the four blocks.
    expect(prompt).toMatch(/\*\*Essence\*\*/);
    expect(prompt).toMatch(/问题/);
    expect(prompt).toMatch(/做法/);
    expect(prompt).toMatch(/证据/);
    expect(prompt).toMatch(/边界/);
    // Old Brief quality bar must not remain as the required section name.
    expect(prompt).not.toMatch(/\*\*Brief\*\*/);
  });

  it('stage-library-read-doc prompt also uses Essence instead of Brief', () => {
    const prompt = readFileSync(join(PROMPTS, 'stage-library-read-doc.md'), 'utf8');
    const structure = prompt.match(/```markdown\n([\s\S]*?)```/)?.[1] ?? '';
    expect(structure).toContain('## Essence');
    expect(structure).not.toContain('## Brief');
    expect(prompt).toMatch(/\*\*Essence\*\*/);
    expect(prompt).not.toMatch(/\*\*Brief\*\*/);
  });
});

describe('libraryReadBodyHasRequiredSections', () => {
  it('returns true only when every required H2 is present', () => {
    const complete = PAPER_READ_SECTIONS.map((s) => `## ${s}\n\nbody`).join('\n');
    expect(libraryReadBodyHasRequiredSections(complete, PAPER_READ_SECTIONS)).toBe(true);
    expect(libraryReadBodyHasRequiredSections('## Essence\n\nok\n', PAPER_READ_SECTIONS)).toBe(false);
    expect(libraryReadBodyHasRequiredSections('', PAPER_READ_SECTIONS)).toBe(false);
  });
});

describe('firstScreenSection / displayLibraryReadMarkdown', () => {
  it('detects Essence as first-screen section', () => {
    expect(firstScreenSection('# T\n\n## Essence\n\nok\n\n## Claims\n')).toBe('Essence');
  });

  it('falls back to Brief for historical artifacts', () => {
    expect(firstScreenSection('# T\n\n## Brief\n\nold\n\n## Claims\n')).toBe('Brief');
  });

  it('prefers Essence when both exist', () => {
    expect(firstScreenSection('## Brief\n\nx\n\n## Essence\n\ny\n')).toBe('Essence');
  });

  it('rewrites lone Brief heading to Essence for display (same slot)', () => {
    const md = '# Title\n\n> frame\n\n## Brief\n\nshort old brief\n\n## Claims\n\n- c';
    const display = displayLibraryReadMarkdown(md);
    expect(display).toContain('## Essence');
    expect(display).not.toMatch(/^## Brief$/m);
    expect(display).toContain('short old brief');
  });

  it('does not rename Brief when Essence is already present', () => {
    const md = '## Essence\n\ne\n\n## Brief\n\nb';
    expect(displayLibraryReadMarkdown(md)).toBe(md);
  });
});

describe('renderLibraryPaper Brief fallback', () => {
  const base: Omit<LibraryPaperDetailView, 'latestReadArtifact'> = {
    root: '/ws',
    paper: {
      id: 'paper_x',
      displayTitle: 'Sample Paper',
      canonicalId: 'arxiv:2607.00001',
      sourceLabel: 'arxiv:2607.00001',
      tags: [],
      readStatus: 'read',
      linkedTopicCount: 0,
      integratedTopicCount: 0,
      updatedAt: '2026-07-01T00:00:00Z',
    },
    topics: [],
    links: [],
    integrations: [],
      topicSuggestions: [],
    notes: [],
    reads: [{
      id: 'read_1',
      paperId: 'paper_x',
      status: 'read',
      updatedAt: '2026-07-01T00:00:00Z',
      createdAt: '2026-07-01T00:00:00Z',
    }],
  };

  it('shows historical Brief content under Essence heading on the paper page', () => {
    const v: LibraryPaperDetailView = {
      ...base,
      latestReadArtifact: {
        path: 'read.md',
        markdown: [
          '---',
          'title: "Sample Paper"',
          'kind: library-read',
          '---',
          '',
          '# Sample Paper',
          '',
          '> Frame lede.',
          '',
          '## Brief',
          '',
          'Historical brief body that must remain readable.',
          '',
          '## Claims',
          '',
          '- a claim',
        ].join('\n'),
      },
    };
    const html = renderLibraryPaper(v);
    expect(html).toContain('Historical brief body that must remain readable.');
    // Display slot uses Essence label for the first-screen section.
    expect(html).toMatch(/<h2[^>]*>Essence<\/h2>/);
    expect(html).not.toMatch(/<h2[^>]*>Brief<\/h2>/);
  });

  it('renders new Essence artifacts as Essence', () => {
    const v: LibraryPaperDetailView = {
      ...base,
      latestReadArtifact: {
        path: 'read.md',
        markdown: [
          '---',
          'kind: library-read',
          '---',
          '',
          '# Sample Paper',
          '',
          '> Frame.',
          '',
          '## Essence',
          '',
          '**问题** x. **做法** y. **证据** z. **边界** w.',
          '',
          '## Claims',
          '',
          '- c',
        ].join('\n'),
      },
    };
    const html = renderLibraryPaper(v);
    expect(html).toMatch(/<h2[^>]*>Essence<\/h2>/);
    expect(html).toContain('**问题**'.replace(/\*/g, '') || '问题');
    expect(html).toContain('问题');
  });
});
