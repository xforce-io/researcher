import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('execa', () => ({ execa: vi.fn() }));

const { execa } = await import('execa');
const { tryPdfToText } = await import('../../src/pipeline/read.js');

afterEach(() => vi.clearAllMocks());

describe('tryPdfToText', () => {
  it('downloads to a fresh dir under os.tmpdir() and cleans up after success', async () => {
    let pdfPath = '';
    (execa as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (bin: string, args: string[]) => {
      if (bin === 'curl') {
        pdfPath = args[args.indexOf('-o') + 1];
        writeFileSync(pdfPath, 'fake-pdf-bytes');
        return { stdout: '' };
      }
      if (bin === 'pdftotext') return { stdout: 'extracted text' };
      throw new Error(`unexpected bin ${bin}`);
    });

    const text = await tryPdfToText('http://example.com/x.pdf');

    expect(text).toBe('extracted text');
    expect(pdfPath.startsWith(tmpdir())).toBe(true);
    expect(pdfPath).not.toMatch(/^\/tmp\/r-\d+\.pdf$/); // not the old predictable shape
    expect(existsSync(pdfPath)).toBe(false); // cleaned up
  });

  it('cleans up even when pdftotext fails', async () => {
    let pdfPath = '';
    (execa as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (bin: string, args: string[]) => {
      if (bin === 'curl') {
        pdfPath = args[args.indexOf('-o') + 1];
        writeFileSync(pdfPath, 'fake');
        return { stdout: '' };
      }
      throw new Error('pdftotext: missing');
    });

    await expect(tryPdfToText('http://example.com/x.pdf')).rejects.toThrow();
    expect(pdfPath).not.toBe('');
    expect(existsSync(pdfPath)).toBe(false);
  });
});
