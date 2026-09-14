import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { newDocumentId, PaperLibrary } from '../../src/library/store.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';

const paths = [
  { mode: 'normal', exit: 'close' },
  { mode: 'normal', exit: 'escape' },
  { mode: 'edit', exit: 'close' },
  { mode: 'edit', exit: 'escape' },
  { mode: 'edit', exit: 'cancel' },
] as const;
type ExitPath = typeof paths[number];
const types = ['note', 'video', 'paper'] as const;

/** #205 S1: execute the served script and native dialog/navigation in Chromium. */
describe('document topic focus in Chromium (#205 S1)', () => {
  let root: string;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let browser: Browser | undefined;
  let base: string;
  let linksBefore: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ channel: 'chromium', headless: true });
    } catch (error) {
      throw new Error('Chromium failed to start. Run npx playwright install --no-shell chromium ' +
        '(Linux: npx playwright install --with-deps --no-shell chromium).', { cause: error });
    }
    root = mkdtempSync(join(tmpdir(), 'researcher-focus-'));
    writeFileSync(join(root, 'researcher.workspace.yml'),
      'version: 1\ntopics:\n  - { path: agents, active: true }\n');
    mkdirSync(join(root, 'agents/.researcher'), { recursive: true });
    writeFileSync(join(root, 'agents/.researcher/project.yaml'),
      'meta:\n  topic_oneline: agents\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 'agents/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nAgents.\n');
    const library = new PaperLibrary(root);
    ids.note = newDocumentId();
    library.createNote({ id: ids.note, title: 'Focus note', body: 'Keep this body.', mutationId: 'note' });
    const source = normalizePaperInput('2401.12345');
    ids.paper = paperIdForSource(source);
    library.upsertPaper({ id: ids.paper, canonicalSource: source, sources: [source],
      identifiers: { arxiv: '2401.12345' }, tags: [], docType: 'paper' });
    ids.video = newDocumentId();
    const media = Buffer.from('focus fixture: no playback or analysis required');
    const sourcePath = join(root, 'focus.mp4');
    writeFileSync(sourcePath, media);
    library.createVideo({ id: ids.video, sourcePath, filename: 'focus.mp4',
      contentType: 'video/mp4', bytes: media.length, mutationId: 'video' });
    for (const id of Object.values(ids)) {
      library.upsertLink({ paperId: id, surfaceType: 'topic', surfaceId: 'agents', rationale: 'Keep this relation.' });
    }
    linksBefore = readFileSync(join(root, '.researcher-workspace/library/links.jsonl'), 'utf8');
    server = await startServer({ root, port: 0 });
    base = `http://127.0.0.1:${server.port}`;
  }, 30_000);

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      try { await server?.close(); }
      finally { if (root) rmSync(root, { recursive: true, force: true }); }
    }
  });

  async function assertFocus(page: Page): Promise<void> {
    await expect.poll(async () => page.locator('[data-open-topics]').evaluate(
      (element) => element === element.ownerDocument.activeElement,
    ), { timeout: 1500, interval: 50 }).toBe(true);
  }

  async function exercise(type: typeof types[number], path: ExitPath, broken: boolean): Promise<void> {
    const context = await browser!.newContext();
    const mutations: string[] = [];
    let injected = false;
    try {
      // No source-site requests, personal browser state, or live service traffic.
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== base) { await route.abort(); return; }
        if (request.method() !== 'GET') {
          mutations.push(request.method() + ' ' + url.pathname);
          await route.abort(); return;
        }
        if (broken && path.exit === 'cancel' && url.searchParams.has('edit')) {
          const response = await route.fetch();
          const body = await response.text();
          const changed = body.replace('data-close-topics href=', 'href=');
          expect(changed).not.toBe(body);
          injected = true;
          await route.fulfill({ response, body: changed });
        } else if (broken && path.exit !== 'cancel' && url.pathname === '/static/document-detail.js') {
          const response = await route.fetch();
          const body = await response.text();
          const changed = path.mode === 'edit'
            ? body.replace("sessionStorage.setItem(focusKey, '1');", '')
            : body.replace('open.focus();\n  });', 'open.blur();\n  });');
          expect(changed).not.toBe(body);
          injected = true;
          await route.fulfill({ response, body: changed });
        } else { await route.continue(); }
      });
      const page = await context.newPage();
      const detail = `${base}/library/documents/${ids[type]}`;
      const response = await page.goto(detail);
      expect(response?.status()).toBe(200);
      await page.locator('[data-open-topics]').click();
      const dialog = page.locator('.document-topic-dialog');
      await dialog.waitFor({ state: 'visible' });
      if (path.mode === 'edit') {
        await dialog.getByRole('link', { name: '编辑', exact: true }).click();
        await page.waitForURL(detail + '?edit=agents');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator('input[name="rationale"]').fill('Do not save this draft.');
      }
      if (path.exit === 'escape') await page.keyboard.press('Escape');
      else if (path.exit === 'cancel') await dialog.getByRole('link', { name: '取消', exact: true }).click();
      else await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await page.waitForURL(detail);
      await dialog.waitFor({ state: 'hidden' });
      expect(page.url()).toBe(detail);
      if (broken) {
        expect(injected).toBe(true);
        // Only a real focus mismatch counts; navigation/startup failures must fail the test.
        await expect(assertFocus(page)).rejects.toThrow('Matcher did not succeed in time.');
        expect(await page.locator('[data-open-topics]').evaluate(
          (element) => element === element.ownerDocument.activeElement,
        )).toBe(false);
      } else { await assertFocus(page); }
      expect(mutations).toEqual([]);
      expect(readFileSync(join(root, '.researcher-workspace/library/links.jsonl'), 'utf8')).toBe(linksBefore);
    } finally { await context.close(); }
  }

  for (const type of types) {
    for (const path of paths) {
      it(`${type} ${path.mode} ${path.exit}: restores focus and URL`, async () => {
        await exercise(type, path, false);
      });
      it(`${type} ${path.mode} ${path.exit}: detects a focus regression`, async () => {
        await exercise(type, path, true);
      });
    }
  }
});
