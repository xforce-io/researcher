import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listNotes } from '../state/note_index.js';
import { parseNote, serializeNote } from '../state/zone.js';
import { countCitations, scoreNote, assignZones } from './zoning.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';

/** Build the citation corpus: landscape + report + README + every note body. */
function buildCorpus(projectRoot: string, noteAbsPaths: string[]): string {
  const parts: string[] = [];
  for (const rel of ['notes/00_research_landscape.md', 'report.md', 'README.md']) {
    const abs = join(projectRoot, rel);
    if (existsSync(abs)) parts.push(readFileSync(abs, 'utf8'));
  }
  for (const abs of noteAbsPaths) parts.push(readFileSync(abs, 'utf8'));
  return parts.join('\n');
}

export async function rebalance(ctx: RunContext): Promise<void> {
  const notes = listNotes(ctx.projectRoot);
  if (notes.length === 0) {
    ctx.zoneManifest = '(no notes yet)';
    return;
  }
  const cfg = ctx.projectYaml.zoning;
  const corpus = buildCorpus(ctx.projectRoot, notes.map((n) => n.absPath));

  const heat = new Map<number, number>();
  for (const n of notes) heat.set(n.num, countCitations(n.num, corpus));
  const maxHeat = Math.max(0, ...heat.values());
  const maxNum = Math.max(...notes.map((n) => n.num));
  const scores = new Map<number, number>();
  for (const n of notes) scores.set(n.num, scoreNote(heat.get(n.num)!, n.num, maxHeat, maxNum));

  const assignments = assignZones(notes, scores, cfg);
  const byNum = new Map(notes.map((n) => [n.num, n]));

  const summary: string[] = ['# Rebalance summary', ''];
  for (const a of assignments) {
    const n = byNum.get(a.num)!;
    const newScore = scores.get(a.num)!;
    if (a.moved) {
      const toRel = `notes/${a.to}/${n.filename}`;
      await gitops.move({ cwd: ctx.projectRoot, from: n.relPath, to: toRel });
      const { body } = parseNote(readFileSync(join(ctx.projectRoot, toRel), 'utf8'));
      writeFileSync(join(ctx.projectRoot, toRel), serializeNote(
        { zone: a.to, pin: n.fm.pin, score: newScore, dwell: 0 }, body,
      ));
      summary.push(`- [${a.num}] ${n.filename}: ${a.from} → ${a.to} (score ${newScore.toFixed(3)})`);
      n.zone = a.to; // reflect for manifest
    } else {
      // stayed: bump dwell (unpinned), refresh score, rewrite in place
      const { body } = parseNote(readFileSync(n.absPath, 'utf8'));
      const dwell = n.fm.pin ? n.fm.dwell : n.fm.dwell + 1;
      writeFileSync(n.absPath, serializeNote(
        { zone: n.zone, pin: n.fm.pin, score: newScore, dwell }, body,
      ));
    }
  }

  const summaryPath = ctx.runDir.path('rebalance-summary.md');
  mkdirSync(ctx.runDir.dir, { recursive: true });
  const moves = assignments.filter((a) => a.moved).length;
  if (moves === 0) summary.push('(no zone changes this run)');
  writeFileSync(summaryPath, summary.join('\n') + '\n');

  ctx.zoneManifest = notes
    .slice()
    .sort((a, b) => a.num - b.num)
    .map((n) => `${String(n.num).padStart(2, '0')} ${n.zone}`)
    .join('\n');
}
