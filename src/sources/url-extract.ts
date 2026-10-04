import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { join } from 'node:path';
import { loadGlobalConfig } from '../config/global-config.js';
import { resolveResearcherHome } from '../paths.js';

export const DEFAULT_MIN_CHARS = 1000;
export const DEFAULT_MIN_WORDS = 150;
/** Reject rec-card-like nodes: link text over this share of visible text. */
export const MAX_LINK_DENSITY = 0.5;

export type HtmlExtractionMethod = 'readability' | 'dom-fallback';
export type ExtractionMethod = HtmlExtractionMethod | 'pdf' | 'plain' | 'user-pasted';
export type ReadFailureCode = 'extract_too_short' | 'empty_text' | 'fetch_error' | 'agent_error';

export interface UrlExtractThreshold {
  minChars: number;
  minWords: number;
}

export interface HtmlExtractResult {
  title: string;
  text: string;
  extractionMethod: HtmlExtractionMethod;
}

export class UrlExtractError extends Error {
  readonly failureCode: Exclude<ReadFailureCode, 'agent_error'>;
  readonly extractedChars?: number;
  readonly extractedWords?: number;
  readonly extractionMethod?: ExtractionMethod;

  constructor(
    message: string,
    opts: {
      failureCode: Exclude<ReadFailureCode, 'agent_error'>;
      extractedChars?: number;
      extractedWords?: number;
      extractionMethod?: ExtractionMethod;
    },
  ) {
    super(message);
    this.name = 'UrlExtractError';
    this.failureCode = opts.failureCode;
    this.extractedChars = opts.extractedChars;
    this.extractedWords = opts.extractedWords;
    this.extractionMethod = opts.extractionMethod;
  }
}

export function defaultUrlExtractThreshold(): UrlExtractThreshold {
  return { minChars: DEFAULT_MIN_CHARS, minWords: DEFAULT_MIN_WORDS };
}

export function loadUrlExtractThreshold(): UrlExtractThreshold {
  const cfg = loadGlobalConfig(join(resolveResearcherHome(), 'config.yaml'));
  return {
    minChars: cfg.urlExtract.minChars,
    minWords: cfg.urlExtract.minWords,
  };
}

export function readFailureFields(err: unknown): {
  failureCode: ReadFailureCode;
  extractedChars?: number;
  extractedWords?: number;
  extractionMethod?: ExtractionMethod;
} {
  if (err instanceof UrlExtractError) {
    return {
      failureCode: err.failureCode,
      extractedChars: err.extractedChars,
      extractedWords: err.extractedWords,
      extractionMethod: err.extractionMethod,
    };
  }
  return { failureCode: 'agent_error' };
}

/** Unicode code points after trim. Words: whitespace tokens; a token with Han counts as that many Han chars. */
export function countBodyStats(text: string): { chars: number; words: number } {
  const trimmed = text.replace(/^\s+|\s+$/g, '');
  const chars = [...trimmed].length;
  if (!trimmed) return { chars: 0, words: 0 };
  let words = 0;
  for (const token of trimmed.split(/\s+/)) {
    if (!token) continue;
    const han = token.match(/\p{Script=Han}/gu);
    words += han && han.length > 0 ? han.length : 1;
  }
  return { chars, words };
}

export function isBodyTooShort(text: string, threshold: UrlExtractThreshold = defaultUrlExtractThreshold()): boolean {
  const { chars, words } = countBodyStats(text);
  return chars < threshold.minChars || words < threshold.minWords;
}

export function extractHtmlArticle(
  html: string,
  threshold: UrlExtractThreshold = defaultUrlExtractThreshold(),
): HtmlExtractResult {
  const pageTitle = pageTitleOf(html);
  const readability = tryReadability(html);
  if (readability.text.trim() && !isBodyTooShort(readability.text, threshold)) {
    return {
      title: readability.title || pageTitle,
      text: readability.text,
      extractionMethod: 'readability',
    };
  }
  const fallback = extractDomFallback(html, threshold);
  if (fallback.text.trim() && !isBodyTooShort(fallback.text, threshold)) {
    return {
      title: fallback.title || pageTitle,
      text: fallback.text,
      extractionMethod: 'dom-fallback',
    };
  }
  const reported = pickReported(readability, fallback);
  const stats = countBodyStats(reported.text);
  if (!reported.text.trim()) {
    throw new UrlExtractError(`url fetch produced empty text`, {
      failureCode: 'empty_text',
      extractedChars: 0,
      extractedWords: 0,
      extractionMethod: reported.extractionMethod,
    });
  }
  throw new UrlExtractError(
    `url extract too short: ${stats.chars} chars, ${stats.words} words (min ${threshold.minChars} chars or ${threshold.minWords} words)`,
    {
      failureCode: 'extract_too_short',
      extractedChars: stats.chars,
      extractedWords: stats.words,
      extractionMethod: reported.extractionMethod,
    },
  );
}

/** Test/debug: Readability output before the body threshold. */
export function previewReadability(html: string): { title: string; text: string } {
  return tryReadability(html);
}

function pickReported(
  readability: { title: string; text: string },
  fallback: { title: string; text: string },
): { title: string; text: string; extractionMethod: HtmlExtractionMethod } {
  if (fallback.text.trim()) {
    return { ...fallback, extractionMethod: 'dom-fallback' };
  }
  return { ...readability, extractionMethod: 'readability' };
}

function pageTitleOf(html: string): string {
  try {
    const { document } = parseHTML(html);
    return (document.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function tryReadability(html: string): { title: string; text: string } {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (!article) return { title: '', text: '' };
    const text = normalizeExtractedText(article.textContent ?? '');
    return { title: (article.title ?? '').trim(), text };
  } catch {
    return { title: '', text: '' };
  }
}

interface Candidate {
  text: string;
  depth: number;
  linkDensity: number;
}

/**
 * Structural fallback (Knox):
 * 1. Candidates are article / main / [role=main] only (never score body against them).
 * 2. Strip nav/aside/footer/header and high-link-density descendant containers.
 *    No class/id keyword matching.
 * 3. Drop a candidate if linkDensity > MAX_LINK_DENSITY.
 * 4. Among remaining nodes that pass the body threshold, pick the deepest;
 *    ties: longer text, then document order. (rule b + density cap)
 * 5. body is used only when no semantic candidate passes.
 */
export function extractDomFallback(
  html: string,
  threshold: UrlExtractThreshold = defaultUrlExtractThreshold(),
): { title: string; text: string } {
  const { document } = parseHTML(html);
  const title = (document.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const semantic = collectCandidates(document, ['article', 'main', '[role="main"]']);
  const passingSemantic = semantic.filter((c) => c.linkDensity <= MAX_LINK_DENSITY && !isBodyTooShort(c.text, threshold));
  if (passingSemantic.length > 0) {
    passingSemantic.sort(compareCandidates);
    return { title, text: passingSemantic[0].text };
  }
  const body = collectCandidates(document, ['body']);
  const passingBody = body.filter((c) => c.linkDensity <= MAX_LINK_DENSITY && !isBodyTooShort(c.text, threshold));
  if (passingBody.length > 0) {
    return { title, text: passingBody[0].text };
  }
  const reportable = [...semantic, ...body].filter((c) => c.linkDensity <= MAX_LINK_DENSITY);
  const pool = reportable.length > 0 ? reportable : [...semantic, ...body];
  pool.sort(compareCandidates);
  return { title, text: pool[0]?.text ?? '' };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.depth !== a.depth) return b.depth - a.depth;
  if (b.text.length !== a.text.length) return b.text.length - a.text.length;
  return 0;
}

function collectCandidates(document: Document, selectors: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const sel of selectors) {
    for (const node of document.querySelectorAll(sel)) {
      const clone = node.cloneNode(true) as Element;
      stripChrome(clone);
      const text = normalizeExtractedText(clone.textContent ?? '');
      if (!text) continue;
      out.push({
        text,
        depth: elementDepth(node),
        linkDensity: linkDensityOf(clone),
      });
    }
  }
  return out;
}

function stripChrome(root: Element): void {
  for (const junk of [...root.querySelectorAll('nav, aside, footer, header, [role="navigation"], [role="complementary"]')]) {
    junk.remove();
  }
  const dense = [...root.querySelectorAll('article, section, div')].reverse();
  for (const el of dense) {
    if (el === root || !el.isConnected) continue;
    if (el.querySelectorAll('a').length >= 2 && linkDensityOf(el) > MAX_LINK_DENSITY) {
      el.remove();
    }
  }
}

function elementDepth(node: Element): number {
  let depth = 0;
  let cur: Element | null = node;
  while (cur.parentElement) {
    depth += 1;
    cur = cur.parentElement;
  }
  return depth;
}

function linkDensityOf(root: Element): number {
  const textChars = countBodyStats(root.textContent ?? '').chars;
  if (textChars === 0) return 1;
  let linkChars = 0;
  for (const a of root.querySelectorAll('a')) {
    linkChars += countBodyStats(a.textContent ?? '').chars;
  }
  return linkChars / textChars;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
