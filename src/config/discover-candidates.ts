import { z } from 'zod';
import { extractJsonPayload } from './extract-json.js';

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
  return extractJsonPayload(raw, looksLikeDiscoverCandidates);
}

function looksLikeDiscoverCandidates(body: string): boolean {
  try {
    parseDiscoverCandidates(body);
    return true;
  } catch {
    return false;
  }
}
