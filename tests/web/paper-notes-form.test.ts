import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { PaperLibrary } from '../../src/library/store.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';

describe('paper annotation form on the detail page', () => {
  let root: string;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let browser: Browser | undefined;
  let base: string;
  let paperId: string;

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ channel: 'chromium', headless: true });
    } catch (error) {
      throw new Error('Chromium failed to start. Run npx playwright install --no-shell chromium.', { cause: error });
    }
    root = mkdtempSync(join(tmpdir(), 'researcher-notes-form-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(root, 't/.researcher'), { recursive: true });
    writeFileSync(join(root, 't/.researcher/project.yaml'),
      'meta:\n  topic_oneline: t\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 't/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nT.\n');
    const source = normalizePaperInput('https://example.com/long-path/introducing-system-one');
    paperId = paperIdForSource(source);
    new PaperLibrary(root).upsertPaper({
      id: paperId,
      canonicalSource: source,
      sources: [source],
      identifiers: { url: 'https://example.com/long-path/introducing-system-one' },
      tags: [],
      docType: 'blog',
    });
    server = await startServer({ root, port: 0 });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
    await browser?.close();
  });

  it('shows the new annotation after submit instead of leaving the form stuck', async () => {
    const page = await browser!.newPage({ viewport: { width: 1100, height: 800 } });
    try {
      const response = await page.goto(`${base}/library/documents/${paperId}#annotations`);
      expect(response?.status()).toBe(200);

      const kindLabel = page.locator('.note-kind-label');
      const kindBox = await kindLabel.boundingBox();
      expect(kindBox).toBeTruthy();
      expect(kindBox!.height).toBeLessThan(40);

      const sourceRow = page.locator('.paper-identity-fm .wide');
      expect(await sourceRow.textContent()).toContain('https://example.com/long-path/introducing-system-one');

      await page.locator('.paper-note-form textarea[name="body"]').fill('typed + probabilistic primitives');
      await page.locator('.paper-note-form button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.paper-note').length === 1);
      expect(await page.locator('.paper-note-body').textContent()).toContain('typed + probabilistic primitives');
      expect(await page.locator('.paper-note-form textarea[name="body"]').inputValue()).toBe('');
      expect(page.url()).toContain('#annotations');
    } finally {
      await page.close();
    }
  });
});
