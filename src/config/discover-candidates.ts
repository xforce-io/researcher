import { z } from 'zod';

const ID_RE = /^(?:arxiv:(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)|doi:10\.\d{4,9}\/\S+|openreview:[a-z0-9_-]+|urlhash:[a-f0-9]{8,64})$/i;

export const DiscoverCandidateSchema = z.object({
  id: z.string().regex(ID_RE, 'id must be namespaced (arxiv:|doi:|openreview:|urlhash:)').transform((id) =>
    id.replace(/^[^:]+/, (namespace) => namespace.toLowerCase())),
  title: z.string().min(1),
  url: z.string().url(),
  abstract: z.string().min(1),
  source: z.string().min(1),
});

export const DiscoverCandidatesSchema = z.object({
  candidates: z.array(DiscoverCandidateSchema),
  search_summary: z.string(),
});

export type DiscoverCandidate = z.infer<typeof DiscoverCandidateSchema>;
export type DiscoverCandidates = z.infer<typeof DiscoverCandidatesSchema>;

export function parseDiscoverCandidates(raw: string): DiscoverCandidates {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`discover-candidates.json is not valid JSON: ${(error as Error).message}`);
  }
  return DiscoverCandidatesSchema.parse(json);
}

/**
 * Pull a discover-candidates object out of free-form agent stdout.
 * Prefers fenced ```json blocks, then the largest balanced {...} slice.
 */
export function extractDiscoverCandidatesJson(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) {
    const body = m[1].trim();
    if (looksLikeDiscoverCandidates(body)) return body;
  }

  // Scan for JSON objects that parse as discover-candidates.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const slice = balancedObjectSlice(text, i);
    if (!slice) continue;
    if (looksLikeDiscoverCandidates(slice)) return slice;
  }
  return null;
}

function looksLikeDiscoverCandidates(body: string): boolean {
  try {
    parseDiscoverCandidates(body);
    return true;
  } catch {
    return false;
  }
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
