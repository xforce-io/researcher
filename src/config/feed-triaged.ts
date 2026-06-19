import { z } from 'zod';

// Output of the feed-triage stage. Unlike discover-triage ("pick ≤1 to deep-read"),
// feed-triage KEEPS the thesis-relevant subset of a digest's tweets for batch synthesis.

const ID_RE = /^xtweet:\d+$/;

const KeptItem = z.object({
  /** xtweet:<numeric status id>, extracted from the tweet's status URL. */
  id: z.string().regex(ID_RE, 'id must be xtweet:<status-id>'),
  handle: z.string().min(1),
  relevance: z.number().int().min(0).max(3),
  alignment: z.enum(['supports', 'extends', 'challenges', 'orthogonal']),
  reason: z.string().min(1),
});

const DroppedItem = z.object({
  id: z.string().regex(ID_RE, 'id must be xtweet:<status-id>'),
  reason: z.string().min(1),
});

export const FeedTriagedSchema = z.object({
  kept: z.array(KeptItem),
  dropped: z.array(DroppedItem),
  summary: z.string(),
});

export type FeedTriaged = z.infer<typeof FeedTriagedSchema>;
export type KeptItem = z.infer<typeof KeptItem>;
export type DroppedItem = z.infer<typeof DroppedItem>;

export function parseFeedTriaged(raw: string): FeedTriaged {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`feed-triaged.json is not valid JSON: ${(e as Error).message}`);
  }
  return FeedTriagedSchema.parse(json);
}
