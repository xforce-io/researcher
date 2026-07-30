/**
 * Library deep-read first-screen section: Essence replaces Brief (#98).
 * Pure helpers so prompt contract + display fallback are unit-testable.
 */

/** Required H2 order for new paper library-read artifacts (body after Frame). */
export const PAPER_READ_SECTIONS = [
  'Essence',
  'Claims',
  'Assumptions',
  'Method',
  'Eval',
  'Weaknesses',
  'Relations',
  'Takeaway',
] as const;

/** Required H2s for non-paper library-read docs (stage-library-read-doc.md). */
export const DOC_READ_SECTIONS = [
  'Essence',
  'Key takeaways',
  'Decisions / claims',
  'Constraints & assumptions',
  'Open questions',
  'Relations',
  'Takeaway',
] as const;

export function requiredPaperReadSections(): readonly string[] {
  return PAPER_READ_SECTIONS;
}

export function requiredDocReadSections(): readonly string[] {
  return DOC_READ_SECTIONS;
}

const H2_RE = /^##[ \t]+(.+?)[ \t]*$/gm;

/**
 * True when every required H2 heading appears in the body.
 * Used to accept finishReason=length when the model finished the structure
 * but hit the token cap on trailing prose / stop tokens.
 */
export function libraryReadBodyHasRequiredSections(
  markdown: string,
  sections: readonly string[],
): boolean {
  if (!markdown.trim() || sections.length === 0) return false;
  const found = new Set<string>();
  H2_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = H2_RE.exec(markdown)) !== null) {
    found.add(m[1].trim());
  }
  return sections.every((s) => found.has(s));
}

/** Which first-screen section exists: prefer Essence, else historical Brief. */
export function firstScreenSection(markdown: string): 'Essence' | 'Brief' | null {
  let hasEssence = false;
  let hasBrief = false;
  H2_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = H2_RE.exec(markdown)) !== null) {
    const title = m[1].trim();
    if (title === 'Essence') hasEssence = true;
    if (title === 'Brief') hasBrief = true;
  }
  if (hasEssence) return 'Essence';
  if (hasBrief) return 'Brief';
  return null;
}

/**
 * Display-only: map lone `## Brief` → `## Essence` so historical artifacts
 * share the same first-screen slot. Does not rewrite when Essence already exists.
 */
export function displayLibraryReadMarkdown(markdown: string): string {
  if (firstScreenSection(markdown) !== 'Brief') return markdown;
  return markdown.replace(/^##[ \t]+Brief[ \t]*$/m, '## Essence');
}
