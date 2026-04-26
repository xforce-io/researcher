import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const SeenEntrySchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  first_seen_run: z.string().min(1),
  decision: z.enum(['deep-read', 'skim', 'reject']),
  reason: z.string(),
});
export type SeenEntry = z.infer<typeof SeenEntrySchema>;

export class Seen {
  private readonly index = new Map<string, SeenEntry>();
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const entry = SeenEntrySchema.parse(JSON.parse(line));
        this.index.set(entry.id, entry);
      }
    }
  }
  has(id: string): boolean {
    return this.index.has(id);
  }
  get(id: string): SeenEntry | undefined {
    return this.index.get(id);
  }
  append(entry: SeenEntry): void {
    if (this.index.has(entry.id)) {
      throw new Error(`seen.jsonl already contains id=${entry.id}`);
    }
    SeenEntrySchema.parse(entry);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.index.set(entry.id, entry);
  }
}
