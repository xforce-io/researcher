import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { newDocumentId, PaperLibrary } from '../../src/library/store.js';

function samplePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

describe('PDF annotation preview errors', () => {
  let browser: Browser;
  let server: Awaited<ReturnType<typeof startServer>>;
  let url: string;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const root = mkdtempSync(join(tmpdir(), 'researcher-preview-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(root, 't/.researcher'), { recursive: true });
    writeFileSync(join(root, 't/.researcher/project.yaml'),
      'meta:\n  topic_oneline: t\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 't/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nT.\n');
    const lib = new PaperLibrary(root);
    const documentId = newDocumentId();
    lib.createNote({ id: documentId, title: 'preview', body: 'body', mutationId: 'doc' });
    const pdf = join(root, 'test.pdf');
    const contents = samplePdf();
    writeFileSync(pdf, contents);
    lib.attachNote({ documentId, sourcePath: pdf, filename: 'test.pdf', contentType: 'application/pdf', bytes: contents.length, mutationId: 'pdf' });
    server = await startServer({ root, port: 0 });
    url = `http://127.0.0.1:${server.port}/library/documents/${documentId}`;
  });

  it('opens the successfully fetched PDF bytes in a new tab', async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        const revoke = URL.revokeObjectURL.bind(URL);
        (window as unknown as { revoked: string[] }).revoked = [];
        URL.revokeObjectURL = (url: string) => {
          (window as unknown as { revoked: string[] }).revoked.push(url);
          revoke(url);
        };
      });
      await page.goto(url);
      for (let i = 0; i < 2; i++) {
        const popupPromise = page.waitForEvent('popup');
        await page.locator('[data-annotation-preview]').click();
        const popup = await popupPromise;
        await popup.waitForURL('blob:**');
        const bytes = await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], popup.url());
        expect(Buffer.from(bytes).equals(samplePdf())).toBe(true);
        const objectUrl = popup.url();
        await popup.close();
        await page.waitForFunction((url) => (window as unknown as { revoked: string[] }).revoked.includes(url), objectUrl);
        const stillExists = await page.evaluate(async (url) => {
          try { await fetch(url); return true; } catch { return false; }
        }, objectUrl);
        expect(stillExists).toBe(false);
      }
    } finally {
      await page.close();
    }
  });

  afterAll(async () => {
    await server?.close();
    await browser?.close();
  });

  for (const failure of ['missing', 'network'] as const) {
    it(`reports a ${failure} failure during the actual file request`, async () => {
      const page = await browser.newPage();
      try {
        await page.goto(url);
        const requests: string[] = [];
        await page.route('**/file?preview=1', async (route) => {
          requests.push(route.request().method());
          if (failure === 'missing') await route.fulfill({ status: 409, contentType: 'application/json', body: '{"code":"attachment_missing"}' });
          else await route.abort('failed');
        });
        const popupPromise = page.waitForEvent('popup');
        await page.locator('[data-annotation-preview]').click();
        const popup = await popupPromise;
        const error = page.locator('.paper-note:has([data-annotation-preview]) [data-file-missing]');
        await error.waitFor({ state: 'visible' });
        expect(await error.textContent()).toContain(failure === 'missing' ? '文件缺失' : '预览失败');
        if (!popup.isClosed()) await popup.waitForEvent('close');
        expect(popup.isClosed()).toBe(true);
        expect(requests).toEqual(['GET']);
      } finally {
        await page.close();
      }
    });
  }
});
