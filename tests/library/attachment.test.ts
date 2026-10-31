import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  acceptAttachmentUpload,
  attachmentExtension,
  safeStoredName,
} from '../../src/library/attachment.js';

describe('attachment accept rules', () => {
  it('allows the listed extensions and infers MIME from octet-stream', () => {
    for (const [filename, contentType] of [
      ['a.pdf', 'application/pdf'],
      ['a.txt', 'text/plain'],
      ['a.md', 'text/markdown'],
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpeg'],
      ['a.webp', 'image/webp'],
    ] as const) {
      const got = acceptAttachmentUpload({ filename, contentType: 'application/octet-stream', bytes: 12 });
      expect(got).toEqual(expect.objectContaining({ ok: true, contentType, filename }));
    }
  });

  it('rejects exe, missing extension, and double extension ending in exe', () => {
    expect(acceptAttachmentUpload({ filename: 'x.exe', contentType: 'application/pdf', bytes: 12 }).ok).toBe(false);
    expect(acceptAttachmentUpload({ filename: 'noext', contentType: 'application/pdf', bytes: 12 }).ok).toBe(false);
    expect(acceptAttachmentUpload({ filename: 'foo.pdf.exe', contentType: 'application/pdf', bytes: 12 })).toEqual(
      expect.objectContaining({ ok: false, status: 400, code: 'unsupported_type' }),
    );
    expect(attachmentExtension('foo.pdf.exe')).toBeNull();
  });

  it('rejects MIME that does not match the extension', () => {
    expect(acceptAttachmentUpload({
      filename: 'shot.jpg',
      contentType: 'image/png',
      bytes: 10,
    })).toEqual(expect.objectContaining({ ok: false, code: 'unsupported_type' }));
  });

  it('accepts size at 25 MiB and rejects one extra byte or empty', () => {
    expect(acceptAttachmentUpload({ filename: 'a.pdf', contentType: 'application/pdf', bytes: ATTACHMENT_MAX_BYTES }).ok).toBe(true);
    expect(acceptAttachmentUpload({
      filename: 'a.pdf',
      contentType: 'application/pdf',
      bytes: ATTACHMENT_MAX_BYTES + 1,
    })).toEqual(expect.objectContaining({ ok: false, status: 413, code: 'payload_too_large' }));
    expect(acceptAttachmentUpload({ filename: 'a.pdf', contentType: 'application/pdf', bytes: 0 })).toEqual(
      expect.objectContaining({ ok: false, status: 400, code: 'invalid_fields' }),
    );
  });

  it('strips path separators and .. from stored names', () => {
    expect(safeStoredName('../etc/passwd.pdf', '.pdf')).toBe('passwd.pdf');
    expect(safeStoredName('a/b\\c.pdf', '.pdf')).toBe('c.pdf');
    expect(safeStoredName('....pdf', '.pdf')).toBe('file.pdf');
  });
});
