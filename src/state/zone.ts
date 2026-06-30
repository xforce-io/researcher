import { load as parseYaml } from 'js-yaml';

export type Zone = 'active' | 'buffer' | 'history';

export interface NoteFrontmatter {
  zone: Zone;
  pin: boolean;
  score: number;
  dwell: number;
}

export const DEFAULT_FM: NoteFrontmatter = { zone: 'active', pin: false, score: 0, dwell: 0 };

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseNote(content: string): { fm: NoteFrontmatter; body: string } {
  const m = FM_RE.exec(content);
  if (!m) return { fm: { ...DEFAULT_FM }, body: content };
  const raw = (parseYaml(m[1]) ?? {}) as Record<string, unknown>;
  const zone = raw.zone === 'buffer' || raw.zone === 'history' ? raw.zone : 'active';
  const fm: NoteFrontmatter = {
    zone,
    pin: raw.pin === true,
    score: typeof raw.score === 'number' ? raw.score : 0,
    dwell: typeof raw.dwell === 'number' ? raw.dwell : 0,
  };
  return { fm, body: content.slice(m[0].length) };
}

export function serializeNote(fm: NoteFrontmatter, body: string): string {
  const head =
    `---\n` +
    `zone: ${fm.zone}\n` +
    `pin: ${fm.pin}\n` +
    `score: ${fm.score}\n` +
    `dwell: ${fm.dwell}\n` +
    `---\n`;
  return head + body;
}
