import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VIDEO_MAX_BYTES } from '../library/video.js';

export async function readMultipartVideo(
  req: IncomingMessage,
  tmpDir: string,
): Promise<{ filePath: string; filename: string; contentType: string; bytes: number; mutationId: string }> {
  const ct = String(req.headers['content-type'] ?? '');
  const len = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(len) && len > VIDEO_MAX_BYTES + 1024 * 1024) {
    throw Object.assign(new Error('video exceeds 2 GiB'), { status: 413 });
  }
  mkdirSync(tmpDir, { recursive: true });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > VIDEO_MAX_BYTES + 1024 * 1024) {
      throw Object.assign(new Error('video exceeds 2 GiB'), { status: 413 });
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks);
  if (/multipart\/form-data/i.test(ct)) {
    return parseMultipart(raw, ct, tmpDir);
  }
  const filename = String(req.headers['x-filename'] ?? 'upload.mp4');
  const mutationId = String(req.headers['x-mutation-id'] ?? '');
  const filePath = join(tmpDir, `upload-${randomUUID()}`);
  writeFileSync(filePath, raw);
  return {
    filePath,
    filename,
    contentType: ct.split(';')[0].trim() || 'application/octet-stream',
    bytes: raw.length,
    mutationId,
  };
}

function parseMultipart(raw: Buffer, contentType: string, tmpDir: string) {
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!bm) throw Object.assign(new Error('multipart boundary missing'), { status: 400 });
  const boundary = `--${(bm[1] || bm[2]).trim()}`;
  const parts = splitParts(raw, boundary);
  let filename = 'upload.mp4';
  let fileType = 'application/octet-stream';
  let fileBuf: Buffer | undefined;
  let mutationId = '';
  for (const part of parts) {
    const splitAt = indexOfDoubleCrlf(part);
    if (splitAt < 0) continue;
    const header = part.subarray(0, splitAt).toString('utf8');
    let body = part.subarray(splitAt + 4);
    if (body.length >= 2 && body.subarray(-2).toString() === '\r\n') body = body.subarray(0, -2);
    const name = /name="([^"]+)"/i.exec(header)?.[1] ?? '';
    const fn = /filename="([^"]*)"/i.exec(header)?.[1];
    const pct = /content-type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim();
    if (fn) {
      filename = fn;
      fileType = pct || fileType;
      fileBuf = body;
    } else if (name === 'mutationId') {
      mutationId = body.toString('utf8').trim();
    } else if (name === 'file' && !fileBuf) {
      fileBuf = body;
      if (pct) fileType = pct;
    }
  }
  if (!fileBuf || !fileBuf.length) throw Object.assign(new Error('file is required'), { status: 400 });
  const filePath = join(tmpDir, `upload-${randomUUID()}`);
  writeFileSync(filePath, fileBuf);
  return { filePath, filename, contentType: fileType, bytes: fileBuf.length, mutationId };
}

function splitParts(raw: Buffer, boundary: string): Buffer[] {
  const token = Buffer.from(`\r\n${boundary}`);
  const start = raw.indexOf(Buffer.from(boundary));
  if (start < 0) return [];
  const inner = raw.subarray(start + Buffer.from(boundary).length);
  const parts: Buffer[] = [];
  let offset = 0;
  if (inner.subarray(0, 2).toString() === '\r\n') offset = 2;
  while (offset < inner.length) {
    const next = inner.indexOf(token, offset);
    if (next < 0) break;
    parts.push(inner.subarray(offset, next));
    offset = next + token.length;
    if (inner.subarray(offset, offset + 2).toString() === '--') break;
    if (inner.subarray(offset, offset + 2).toString() === '\r\n') offset += 2;
  }
  return parts;
}

function indexOfDoubleCrlf(buf: Buffer): number {
  return buf.indexOf(Buffer.from('\r\n\r\n'));
}
