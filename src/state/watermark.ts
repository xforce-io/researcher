import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const WatermarkSchema = z.object({
  last_run_completed_at: z.string(),
  last_run_window: z.object({ from: z.string(), to: z.string() }),
  last_run_id: z.string(),
});
export type Watermark = z.infer<typeof WatermarkSchema>;

export function readWatermark(path: string): Watermark | null {
  if (!existsSync(path)) return null;
  return WatermarkSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeWatermark(path: string, w: Watermark): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(w, null, 2) + '\n');
}
