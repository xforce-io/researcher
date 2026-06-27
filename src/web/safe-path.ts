import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** True iff `child` is `base` or strictly inside it (after symlink-free resolve). */
function isInside(base: string, child: string): boolean {
  const b = resolve(base);
  const c = resolve(child);
  return c === b || c.startsWith(b + sep);
}

/** Absolute path of a `.md` doc inside the topic, or null if unsafe/missing. */
export function safeDocPath(topicDir: string, rel: string): string | null {
  const abs = resolve(topicDir, rel);
  if (!isInside(topicDir, abs)) return null;
  if (!abs.endsWith('.md')) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

/** Absolute path of `papers/<id>.pdf` inside the topic, or null if unsafe/missing. */
export function safePaperPath(topicDir: string, id: string): string | null {
  const abs = resolve(topicDir, 'papers', `${id}.pdf`);
  if (!isInside(topicDir, abs)) return null;
  if (!existsSync(abs)) return null;
  return abs;
}
