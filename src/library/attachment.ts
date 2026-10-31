export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
} as const;

export type AnnotationContentType = (typeof ALLOWED)[keyof typeof ALLOWED];
export type AttachmentExtension = keyof typeof ALLOWED;

export type AttachmentAccept =
  | { ok: true; contentType: AnnotationContentType; ext: AttachmentExtension; filename: string }
  | { ok: false; status: number; code: string; message: string };

export function posixBasename(name: string): string {
  return name.replace(/\\/g, '/').split('/').pop() || name;
}

export function attachmentExtension(filename: string): AttachmentExtension | null {
  const base = posixBasename(filename).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot);
  return ext in ALLOWED ? ext as AttachmentExtension : null;
}

export function displayFilename(filename: string): string {
  return posixBasename(filename);
}

export function safeStoredName(filename: string, ext: AttachmentExtension): string {
  const base = posixBasename(filename);
  const stem = base.replace(/\.[^.]+$/, '');
  const cleaned = stem
    .replace(/[\\/]/g, '')
    .replace(/\.\./g, '')
    .replace(/[^\w.\- \u0080-\uFFFF]/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return `${cleaned || 'file'}${ext.toLowerCase()}`;
}

export function acceptAttachmentUpload(input: {
  filename: string;
  contentType: string;
  bytes: number;
}): AttachmentAccept {
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) {
    return { ok: false, status: 400, code: 'invalid_fields', message: 'empty attachment file' };
  }
  if (input.bytes > ATTACHMENT_MAX_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: 'attachment exceeds 25 MiB' };
  }
  const ext = attachmentExtension(input.filename);
  if (!ext) {
    return { ok: false, status: 400, code: 'unsupported_type', message: 'attachment type is not allowed' };
  }
  const expected = ALLOWED[ext];
  const ct = input.contentType.split(';')[0].trim().toLowerCase();
  if (ct && ct !== 'application/octet-stream' && ct !== expected) {
    return { ok: false, status: 400, code: 'unsupported_type', message: `Content-Type must be ${expected}` };
  }
  return {
    ok: true,
    contentType: expected,
    ext,
    filename: displayFilename(input.filename),
  };
}
