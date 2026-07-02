import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNote, type NoteFrontmatter, type Zone } from './zone.js';

export const ZONE_DIRS = ['notes/active', 'notes/buffer', 'notes/history'] as const;

export interface NoteEntry {
  num: number;
  filename: string;
  zone: Zone;
  relPath: string;
  absPath: string;
  fm: NoteFrontmatter;
}

const ZONES: Zone[] = ['active', 'buffer', 'history'];
const NOTE_RE = /^(\d+)_.*\.md$/;

export function listNotes(projectRoot: string): NoteEntry[] {
  const notesDir = join(projectRoot, 'notes');
  const out: NoteEntry[] = [];
  const collect = (dirRel: string) => {
    const abs = join(projectRoot, dirRel);
    if (!existsSync(abs)) return;
    const dirZone = dirRel.replace(/^notes\//, '') as Zone;
    for (const f of readdirSync(abs)) {
      const m = NOTE_RE.exec(f);
      if (!m || f.startsWith('00_')) continue;
      const relPath = `${dirRel}/${f}`;
      const absPath = join(projectRoot, relPath);
      const { fm } = parseNote(readFileSync(absPath, 'utf8'));
      out.push({ num: parseInt(m[1], 10), filename: f, zone: dirZone, relPath, absPath, fm });
    }
  };
  if (!existsSync(notesDir)) return out;
  for (const z of ZONES) collect(`notes/${z}`);
  return out;
}

export function nextNoteNumber(projectRoot: string): number {
  const max = listNotes(projectRoot).reduce((m, n) => (n.num > m ? n.num : m), 0);
  return max + 1;
}
