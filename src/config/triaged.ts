import { z } from 'zod';

const Axes = z.object({
  relevance: z.number().int().min(0).max(3),
  alignment: z.enum(['supports', 'extends', 'challenges', 'orthogonal']),
  novelty: z.enum(['incremental', 'substantial', 'paradigm-shift']),
  gravity: z.enum(['low', 'medium', 'high']),
});

const ID_RE = /^(arxiv|doi|openreview|urlhash):/;

const Candidate = z.object({
  id: z.string().regex(ID_RE, 'id must be namespaced (arxiv:|doi:|openreview:|urlhash:)'),
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
