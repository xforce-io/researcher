import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface LegacyPendingNote {
  topicRoot: string;
  relPath: string;
  filename: string;
  num: number;
}

const NOTE_RE = /^(\d+)_.*\.md$/;

export function discoverLegacyPendingNotes(topicRoot: string): LegacyPendingNote[] {
  const relDir = 'notes/pending';
  const absDir = join(topicRoot, relDir);
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir)
    .map((filename) => {
      const m = NOTE_RE.exec(filename);
      if (!m || filename.startsWith('00_')) return null;
      return {
        topicRoot,
        relPath: `${relDir}/${filename}`,
        filename,
        num: Number(m[1]),
      };
    })
    .filter((x): x is LegacyPendingNote => x !== null)
    .sort((a, b) => a.num - b.num);
}
