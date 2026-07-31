/**
 * Shared host-side JSON recovery for agent stdout.
 *
 * Agents are instructed to return pure JSON, but models routinely wrap the
 * payload in narration or markdown fences. Every stage that consumes a JSON
 * artifact from an agent response must go through this single extractor
 * instead of growing its own tolerance logic.
 */

/**
 * Pull a JSON object out of free-form agent stdout.
 * Prefers fenced ```json blocks, then the largest balanced {...} slice.
 * `isValid` must fully validate a candidate slice (parse + schema).
 */
export function extractJsonPayload(raw: string, isValid: (body: string) => boolean): string | null {
  const text = raw.trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) {
    const body = m[1].trim();
    if (isValid(body)) return body;
  }

  // Scan for JSON objects that pass validation.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const slice = balancedObjectSlice(text, i);
    if (!slice) continue;
    if (isValid(slice)) return slice;
  }
  return null;
}

function balancedObjectSlice(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
