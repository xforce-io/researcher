import type { SourceRef } from './model.js';

export const DOC_TYPES = ['paper', 'design-doc', 'spec', 'blog', 'api-doc', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export function parseDocType(raw: string): DocType {
  const v = raw.trim().toLowerCase();
  if ((DOC_TYPES as readonly string[]).includes(v)) return v as DocType;
  throw new Error(`invalid docType: ${raw}. expected one of ${DOC_TYPES.join(', ')}`);
}

/** Infer a document type from the source identity when the user did not set one. */
export function defaultDocTypeForSource(source: SourceRef): DocType {
  if (source.kind === 'arxiv') return 'paper';
  const url = (source.url ?? source.id.replace(/^url:/, '')).toLowerCase();
  if (/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S*\/status\//.test(url)) return 'blog';
  if (/\/blog(\/|$)|\/posts?\/|medium\.com|substack\.com/.test(url)) return 'blog';
  if (/\/adr(\/|$)|\/design([-_/]|$)|\/design-docs?\/|architecture-decision/.test(url)) return 'design-doc';
  if (/rfc-editor\.org\/rfc\/|\/rfc\d{3,5}|\/specs?\/|\/standards?\//.test(url)) return 'spec';
  if (/\/api([-_/]|$)|\/reference\/|\/sdk\//.test(url)) return 'api-doc';
  return 'other';
}

export function isPaperDocType(docType: DocType | undefined): boolean {
  return !docType || docType === 'paper';
}
