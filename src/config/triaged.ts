import { z } from 'zod';
import { extractJsonPayload } from './extract-json.js';

const Axes = z.object({
  relevance: z.number().int().min(0).max(3),
  alignment: z.enum(['supports', 'extends', 'challenges', 'orthogonal']),
  novelty: z.enum(['incremental', 'substantial', 'paradigm-shift']),
  gravity: z.enum(['low', 'medium', 'high']),
});

const ID_RE = /^(?:arxiv:(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)|doi:10\.\d{4,9}\/\S+|openreview:[a-z0-9_-]+|urlhash:[a-f0-9]{8,64})$/i;

const Candidate = z.object({
  id: z.string().regex(ID_RE, 'id must be namespaced (arxiv:|doi:|openreview:|urlhash:)').transform((id) =>
    id.replace(/^[^:]+/, (namespace) => namespace.toLowerCase())),
  title: z.string().min(1),
  url: z.string().url().optional(),
  source: z.string().min(1),
  decision: z.enum(['deep-read', 'skim', 'reject']),
  axes: Axes,
  reason: z.string().min(1),
});

export const TriagedSchema = z.object({
  candidates: z.array(Candidate),
  search_summary: z.string(),
});

export type Triaged = z.infer<typeof TriagedSchema>;
export type TriageCandidate = z.infer<typeof Candidate>;

export function parseTriaged(raw: string): Triaged {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`triaged.json is not valid JSON: ${(e as Error).message}`);
  }
  return TriagedSchema.parse(json);
}

/**
 * Parse a triage agent response that should be pure JSON but may arrive
 * wrapped in narration or markdown fences.
 *
 * Strict parse runs first so a well-formed JSON body that fails the schema
 * still surfaces the precise zod error. Extraction is attempted only when the
 * response as a whole is not JSON; if no valid payload can be recovered the
 * original strict-parse error is thrown (fail fast, no further fallbacks).
 */
export function parseTriagedOutput(raw: string): Triaged {
  try {
    return parseTriaged(raw);
  } catch (error) {
    const extracted = extractJsonPayload(raw, looksLikeTriaged);
    if (!extracted) throw error;
    return parseTriaged(extracted);
  }
}

function looksLikeTriaged(body: string): boolean {
  try {
    parseTriaged(body);
    return true;
  } catch {
    return false;
  }
}
