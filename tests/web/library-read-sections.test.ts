import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  displayLibraryReadMarkdown,
  firstScreenSection,
  libraryReadBodyHasRequiredSections,
  markEssenceLeadHeadings,
  PAPER_READ_SECTIONS,
  requiredPaperReadSections,
  stripLibraryReadPreamble,
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
    // Quality bar documents the four teaching blocks.
    expect(prompt).toMatch(/\*\*Essence\*\*/);
    expect(prompt).toMatch(/\*\*场景\*\*/);
    expect(prompt).toMatch(/\*\*对照\*\*/);
    expect(prompt).toMatch(/\*\*步骤\*\*/);
    expect(prompt).toMatch(/\*\*证据\*\*/);
    expect(prompt).toMatch(/别误读/);
    expect(prompt).toMatch(/50/);
    // Old compressed-abstract lead-ins are not the first-screen contract.
    expect(prompt).not.toMatch(/\*\*问题\*\*/);
    expect(prompt).not.toMatch(/\*\*做法\*\*/);
    expect(prompt).not.toMatch(/\*\*边界\*\*/);
    // Old Brief quality bar must not remain as the required section name.
    expect(prompt).not.toMatch(/\*\*Brief\*\*/);
  });

  it('stage-library-read-doc prompt also uses Essence instead of Brief', () => {
    const prompt = readFileSync(join(PROMPTS, 'stage-library-read-doc.md'), 'utf8');
    const structure = prompt.match(/```markdown\n([\s\S]*?)```/)?.[1] ?? '';
    expect(structure).toContain('## Essence');
    expect(structure).not.toContain('## Brief');
    expect(prompt).toMatch(/\*\*Essence\*\*/);
    expect(prompt).toMatch(/\*\*场景\*\*/);
    expect(prompt).toMatch(/\*\*对照\*\*/);
    expect(prompt).toMatch(/\*\*步骤\*\*/);
    expect(prompt).toMatch(/\*\*证据\*\*/);
    expect(prompt).toMatch(/别误读/);
    expect(prompt).not.toMatch(/\*\*问题\*\*/);
    expect(prompt).not.toMatch(/\*\*做法\*\*/);
    expect(prompt).not.toMatch(/\*\*边界\*\*/);
    expect(prompt).not.toMatch(/\*\*Brief\*\*/);
  });

  it('writing discipline carves out Frame+Essence teaching copy', () => {
    const md = readFileSync(join(process.cwd(), 'methodology/06-writing.md'), 'utf8');
    expect(md).toMatch(/Library first-screen exception/);
    expect(md).toMatch(/场景 \/ 对照 \/ 步骤 \/ 证据/);
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

describe('stripLibraryReadPreamble', () => {
  it('drops narration before a line-start H1', () => {
    const raw = [
      '先读取完整请求与常驻技能，再按 Library 深读规范产出笔记。',
      '',
      '# Compile by Training',
      '',
      '> frame',
      '',
      '## Essence',
    ].join('\n');
    const out = stripLibraryReadPreamble(raw);
    expect(out.startsWith('# Compile by Training')).toBe(true);
    expect(out).not.toContain('先读取完整请求');
  });

  it('splits a title glued after a fullwidth period', () => {
    const raw =
      '随后只输出 artifact body。# Compile by Training: Turning Natural-Language Specifications into Local Neural Functions\n\n> frame\n\n## Essence\n';
    const out = stripLibraryReadPreamble(raw);
    expect(out.startsWith('# Compile by Training')).toBe(true);
    expect(out).not.toContain('artifact body');
  });
});

describe('markEssenceLeadHeadings', () => {
  it('adds essence-lead class to h3s between Essence and the next h2', () => {
    const html = [
      '<h2>Essence</h2>',
      '<h3>场景</h3><p>s</p>',
      '<h3>对照</h3><ul><li>a</li></ul>',
      '<h2>Claims</h2>',
      '<h3>not first screen</h3>',
    ].join('');
    const marked = markEssenceLeadHeadings(html);
    expect(marked).toMatch(/<h3 class="essence-lead">场景<\/h3>/);
    expect(marked).toMatch(/<h3 class="essence-lead">对照<\/h3>/);
    expect(marked).toContain('<h3>not first screen</h3>');
    expect(marked).not.toMatch(/<h3 class="essence-lead">not first screen<\/h3>/);
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
          '### 场景',
          '',
          'a runnable agent already exists.',
          '',
          '### 对照',
          '',
          '- old: rewrite the loop in the trainer',
          '- this: swap the LLM endpoint',
          '',
          '### 步骤',
          '',
          '1. point the harness at a proxy',
          '',
          '### 证据',
          '',
          'one number. 别误读: not a continuous token trajectory.',
          '',
          '## Claims',
          '',
          '- c',
        ].join('\n'),
      },
    };
    const html = renderLibraryPaper(v);
    expect(html).toMatch(/<h2[^>]*>Essence<\/h2>/);
    expect(html).toContain('场景');
    expect(html).toContain('对照');
    expect(html).toContain('步骤');
    expect(html).toContain('证据');
    expect(html).toContain('别误读');
    expect(html).toMatch(/<h3[^>]*class="[^"]*essence-lead[^"]*"[^>]*>场景<\/h3>/);
    expect(html).not.toContain('**问题**');
  });

  it('hides glued model narration before the card title on the paper page', () => {
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
          '先读取完整请求与常驻技能，再按 Library 深读规范产出笔记。随后只输出 artifact body。# Sample Paper',
          '',
          '> Frame lede.',
          '',
          '## Essence',
          '',
          '### 场景',
          '',
          'a task.',
        ].join('\n'),
      },
    };
    const html = renderLibraryPaper(v);
    expect(html).not.toContain('先读取完整请求与常驻技能');
    expect(html).not.toContain('随后只输出 artifact body');
    expect(html).toContain('Frame lede.');
    expect(html).toMatch(/<h2[^>]*>Essence<\/h2>/);
  });
});
