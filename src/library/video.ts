import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, readSync } from 'node:fs';
import type { VideoCue } from './model.js';

export const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
} as const;

export type VideoContentType = (typeof ALLOWED)[keyof typeof ALLOWED];

export function videoExtension(filename: string): '.mp4' | '.webm' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp4')) return '.mp4';
  if (lower.endsWith('.webm')) return '.webm';
  return null;
}

export function acceptVideoUpload(input: {
  filename: string;
  contentType: string;
  bytes: number;
}): { ok: true; contentType: VideoContentType; ext: '.mp4' | '.webm' } | { ok: false; status: number; message: string } {
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) {
    return { ok: false, status: 400, message: 'empty video file' };
  }
  if (input.bytes > VIDEO_MAX_BYTES) {
    return { ok: false, status: 413, message: 'video exceeds 2 GiB' };
  }
  const ext = videoExtension(input.filename);
  if (!ext) {
    return { ok: false, status: 400, message: 'only .mp4 and .webm are supported' };
  }
  const expected = ALLOWED[ext];
  const ct = input.contentType.split(';')[0].trim().toLowerCase();
  if (ct !== expected) {
    return { ok: false, status: 400, message: `Content-Type must be ${expected}` };
  }
  return { ok: true, contentType: expected, ext };
}

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const cut = base.replace(/\.(mp4|webm)$/i, '');
  const chars = [...cut];
  return chars.slice(0, 200).join('');
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256FileSync(path: string): string {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(256 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

export function normalizeCues(raw: Array<{ start?: number; end?: number; text?: string }> | undefined): VideoCue[] {
  const out: VideoCue[] = [];
  for (const seg of raw ?? []) {
    const text = String(seg.text ?? '').trim();
    const start = Number(seg.start);
    const end = Number(seg.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const zh = String((seg as { zh?: string }).zh ?? '').trim();
    out.push(zh ? { id: out.length, start, end, text, zh } : { id: out.length, start, end, text });
  }
  return out;
}

export function searchCueIds(cues: VideoCue[], query: string): number[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return cues.map((c) => c.id);
  return cues.filter((c) =>
    c.text.toLowerCase().includes(q) || String(c.zh ?? '').toLowerCase().includes(q),
  ).map((c) => c.id);
}

/**
 * Current cue among a visible subset: t ∈ [start, end).
 * Overlaps: greatest start, then smaller id. Gaps / after last / filtered-out → null.
 */
export function currentCueAtTime(visible: VideoCue[], t: number): VideoCue | null {
  const time = Number(t);
  if (!visible.length || !Number.isFinite(time)) return null;
  const hits = visible.filter((c) => c.start <= time && time < c.end);
  if (!hits.length) return null;
  hits.sort((a, b) => (b.start - a.start) || (a.id - b.id));
  return hits[0];
}

export function classifyAnalysis(cues: VideoCue[]): { noSpeech: boolean } {
  return { noSpeech: cues.length === 0 };
}
