import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('@mozilla/readability', () => ({
  Readability: class {
    parse() {
      return { title: 'Teaser', textContent: 'Short teaser, with commas. Still under the threshold.' };
    }
  },
}));
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLibraryRead } from '../../src/web/library-read.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';
import type { Paper } from '../../src/library/model.js';
import { longParagraphs } from '../helpers/long-prose.js';

class RecordingAdapter implements AgentRuntime {
  id = 'recording';
  lastPrompt = '';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.lastPrompt = opts.userPrompt;
    return {
      output: [
        '# Library Read Paper',
        '',
        '## Essence',
        '',
        'ok',
        '',
        '## Claims',
        '',
        '- x',
        '',
        '## Assumptions',
        '',
        '- y',
        '',
        '## Method',
        '',
        '- z',
        '',
        '## Eval',
        '',
        '- e',
        '',
        '## Weaknesses',
        '',
        '- w',
        '',
        '## Relations',
        '',
        '- standalone [low]: test.',
        '',
        '## Takeaway',
        '',
        '- remember.',
      ].join('\n'),
      modifiedFiles: [],
      exitCode: 0,
    };
  }
}

function urlPaper(): Paper {
  return {
    id: 'paper_url_extract_runner',
    canonicalSource: { kind: 'url', id: 'url:https://example.com/fallback', url: 'https://example.com/fallback' },
    sources: [{ kind: 'url', id: 'url:https://example.com/fallback', url: 'https://example.com/fallback' }],
    identifiers: { url: 'https://example.com/fallback' },
    tags: [],
    docType: 'blog',
    createdAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
  };
}

describe('library read extract fallback (#212 Knox)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEARCHER_HOME;
  });

  it('writes a read when Readability misses and DOM fallback passes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'r-home-fb-'));
    process.env.RESEARCHER_HOME = home;
    const html = `<!doctype html><html><head><title>Teaser</title></head><body>
      <article><p>Short teaser, with commas, still under the threshold.</p><p>More teaser punctuation.</p></article>
      <div role="main">${longParagraphs('DOM_FALLBACK_WIN unique')}</div>
    </body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    const root = mkdtempSync(join(tmpdir(), 'rsw-fb-ok-'));
    const adapter = new RecordingAdapter();
    const result = await runLibraryRead({
      workspaceRoot: root,
      paper: urlPaper(),
      readId: 'read_fallback_ok',
      adapter,
    });
    expect(result.extractionMethod).toBe('dom-fallback');
    expect(existsSync(join(root, result.artifactPath))).toBe(true);
    expect(readFileSync(join(root, result.artifactPath), 'utf8')).toContain('extraction_method: "dom-fallback"');
    expect(adapter.lastPrompt).toContain('DOM_FALLBACK_WIN');
  });

  it('does not write an artifact or cache when both extractors miss', async () => {
    const home = mkdtempSync(join(tmpdir(), 'r-home-fb-miss-'));
    process.env.RESEARCHER_HOME = home;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title>Tiny</title></head><body><article><p>nope</p></article></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    )));
    const root = mkdtempSync(join(tmpdir(), 'rsw-fb-miss-'));
    const adapter = new RecordingAdapter();
    await expect(runLibraryRead({
      workspaceRoot: root,
      paper: urlPaper(),
      readId: 'read_fallback_miss',
      adapter,
    })).rejects.toThrow(/too short|empty text/);
    expect(adapter.lastPrompt).toBe('');
    expect(existsSync(join(
      root,
      '.researcher-workspace/library/documents/paper_url_extract_runner/reads/read_fallback_miss.md',
    ))).toBe(false);
    const cacheDir = join(home, 'cache', 'url');
    if (existsSync(cacheDir)) {
      expect(readdirSync(cacheDir).filter((f) => f.endsWith('.txt'))).toEqual([]);
    }
  });
});
