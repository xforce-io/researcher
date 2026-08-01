import { describe, it, expect } from 'vitest';
import {
  isLibraryReadFrontmatter,
  libraryReadEmbedBody,
  splitFrontmatter,
  stripDuplicateLeadingH1,
} from '../../src/markdown/frontmatter.js';

const SAMPLE_ARTIFACT = [
  '---',
  'title: "TRACE: Turn-level Reward"',
  'authors: ["A", "B"]',
  'paper_id: "paper_arxiv_2607_13988"',
  'source_kind: "arxiv"',
  'source_id: "arxiv:2607.13988"',
  'source_url: "https://arxiv.org/abs/2607.13988"',
  'pdf_url: "https://arxiv.org/pdf/2607.13988"',
  'read_id: "read_paper_arxiv_2607_13988"',
  'kind: library-read',
  'doc_type: "paper"',
  'tags: []',
  '---',
  '',
  '# TRACE: Turn-level Reward',
  '',
  '> one-line essence',
  '',
  '## Essence',
  '',
  'body text',
  '',
].join('\n');

describe('splitFrontmatter', () => {
  it('splits a leading fence into fm + body', () => {
    const { fm, body } = splitFrontmatter(SAMPLE_ARTIFACT);
    expect(fm?.kind).toBe('library-read');
    expect(fm?.paper_id).toBe('"paper_arxiv_2607_13988"');
    expect(body.startsWith('# TRACE:')).toBe(true);
  });

  it('returns null fm when there is no fence', () => {
    expect(splitFrontmatter('# Hi\n').fm).toBeNull();
  });
});

describe('stripDuplicateLeadingH1', () => {
  it('removes a matching leading H1', () => {
    expect(stripDuplicateLeadingH1('# TRACE: Turn-level Reward\n\nbody\n', 'TRACE: Turn-level Reward'))
      .toBe('body\n');
  });

  it('keeps a non-matching H1', () => {
    expect(stripDuplicateLeadingH1('# Other\n\nbody\n', 'TRACE')).toBe('# Other\n\nbody\n');
  });
});

describe('isLibraryReadFrontmatter', () => {
  it('detects kind: library-read', () => {
    expect(isLibraryReadFrontmatter({ kind: 'library-read', title: '"T"' })).toBe(true);
  });

  it('detects paper_id / read_id system keys', () => {
    expect(isLibraryReadFrontmatter({ paper_id: '"p"', title: '"T"' })).toBe(true);
  });

  it('does not treat ordinary note mastheads as library-read', () => {
    expect(isLibraryReadFrontmatter({
      paper: '"Why Reasoning Fails"',
      arxiv: '"2601.22311"',
      authors: '["A"]',
      year: '2026',
    })).toBe(false);
  });
});

describe('libraryReadEmbedBody', () => {
  it('drops system frontmatter and duplicate title for topic integration notes', () => {
    const embed = libraryReadEmbedBody(SAMPLE_ARTIFACT, 'TRACE: Turn-level Reward');
    expect(embed).toContain('> one-line essence');
    expect(embed).toContain('## Essence');
    expect(embed).toContain('body text');
    expect(embed).not.toMatch(/^---/m);
    expect(embed).not.toContain('paper_id');
    expect(embed).not.toContain('read_id');
    expect(embed).not.toContain('kind: library-read');
    expect(embed).not.toContain('# TRACE: Turn-level Reward');
  });

  it('passes through body-only artifacts', () => {
    expect(libraryReadEmbedBody('# Lib\n\nbody\n', 'Other')).toBe('# Lib\n\nbody');
  });
});
