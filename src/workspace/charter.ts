import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CHARTER.md slicing contract (shared with research-harness/CHARTER.md):
 *   - "shared core" = everything before the first `### ` heading.
 *   - per-pillar "excerpt" = the `### ` block whose heading contains the
 *     backtick-wrapped pillar path (e.g. "### `trace`"), running until the
 *     next `## ` or `### ` heading (or EOF).
 *   - therefore `### ` is RESERVED for per-pillar excerpts inside CHARTER.md.
 *
 * A topic's synced charter = shared core + its own excerpt. This keeps the
 * anchor tight (invariants + this pillar's mandate/boundary/interfaces) without
 * dragging the whole map into every pillar.
 */

export const SYNCED_CHARTER_HEADER =
  '<!-- AUTO-SYNCED FROM research-harness/CHARTER.md — do not edit here. ' +
  'Edit the super-repo CHARTER.md instead. -->\n\n';

export interface CharterSlice {
  sharedCore: string;
  /** null when CHARTER.md has no excerpt for this pillar. */
  excerpt: string | null;
  /** Header + sharedCore (+ excerpt). What gets written to the topic. */
  combined: string;
}

const PILLAR_HEADING = /^### /;
const SECTION_HEADING = /^#{2,3} /;

export function sliceCharter(charter: string, pillarPath: string): CharterSlice {
  const lines = charter.split('\n');

  const firstExcerptIdx = lines.findIndex((l) => PILLAR_HEADING.test(l));
  const sharedCore = (firstExcerptIdx === -1 ? lines : lines.slice(0, firstExcerptIdx))
    .join('\n')
    .trimEnd();

  // Locate this pillar's excerpt block by a backtick-wrapped path token in a ### heading.
  const token = '`' + pillarPath + '`';
  const startIdx = lines.findIndex((l) => PILLAR_HEADING.test(l) && l.includes(token));
  let excerpt: string | null = null;
  if (startIdx !== -1) {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (SECTION_HEADING.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    excerpt = lines.slice(startIdx, endIdx).join('\n').trimEnd();
  }

  const combined =
    SYNCED_CHARTER_HEADER +
    sharedCore +
    (excerpt ? `\n\n${excerpt}\n` : '\n');

  return { sharedCore, excerpt, combined };
}

/**
 * Sync the pillar's charter slice into <superRoot>/<topicPath>/.researcher/charter.md.
 * No-op (returns null) when the topic has no .researcher/ directory.
 * Idempotent: overwrites the synced file each call.
 */
export function syncCharterToTopic(
  superRoot: string,
  topicPath: string,
  charterContent: string,
): string | null {
  const researcherDir = join(superRoot, topicPath, '.researcher');
  if (!existsSync(researcherDir)) return null;
  const { combined } = sliceCharter(charterContent, topicPath);
  const out = join(researcherDir, 'charter.md');
  mkdirSync(researcherDir, { recursive: true });
  writeFileSync(out, combined);
  return out;
}
