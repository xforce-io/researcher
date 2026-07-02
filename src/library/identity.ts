import { createHash } from 'node:crypto';
import { arxivAbsUrl, canonicalizeArxivId } from '../sources/arxiv.js';
import { canonicalizeUrl } from '../sources/url.js';
import type { SourceRef } from './model.js';

export function normalizePaperInput(input: string): SourceRef {
  try {
    const id = canonicalizeArxivId(input);
    return {
      kind: 'arxiv',
      id,
      url: arxivAbsUrl(id),
    };
  } catch {
    /* try URL */
  }
  const id = canonicalizeUrl(input);
  return {
    kind: 'url',
    id,
    url: id.slice('url:'.length),
  };
}

export function paperIdForSource(source: SourceRef): string {
  if (source.kind === 'arxiv') {
    return `paper_arxiv_${source.id.replace(/^arxiv:/, '').replace(/\./g, '_')}`;
  }
  const digest = createHash('sha256').update(source.id).digest('hex').slice(0, 16);
  return `paper_url_${digest}`;
}

export function identifiersForSource(source: SourceRef): { arxiv?: string; url?: string } {
  if (source.kind === 'arxiv') return { arxiv: source.id.replace(/^arxiv:/, '') };
  return { url: source.url ?? source.id.slice('url:'.length) };
}
