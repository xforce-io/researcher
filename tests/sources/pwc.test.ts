import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isPwcAvailable, pwcSearch, resolvePwcBin, PwcError } from '../../src/sources/pwc.js';

function writeExecutable(dir: string, name: string, body: string): string {
  const bin = join(dir, name);
  writeFileSync(bin, `#!/usr/bin/env node\n${body}`);
  chmodSync(bin, 0o755);
  return bin;
}

afterEach(() => {
  delete process.env.RESEARCHER_PWC_BIN;
});

describe('resolvePwcBin', () => {
  it('defaults to pwc and honors RESEARCHER_PWC_BIN', () => {
    expect(resolvePwcBin()).toBe('pwc');
    process.env.RESEARCHER_PWC_BIN = ' /custom/pwc ';
    expect(resolvePwcBin()).toBe('/custom/pwc');
  });
});

describe('isPwcAvailable', () => {
  it('returns false for a missing binary', async () => {
    await expect(isPwcAvailable(join(tmpdir(), 'no-such-pwc-bin'))).resolves.toBe(false);
  });

  it('returns true when pwc version exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwc-avail-'));
    const bin = writeExecutable(dir, 'pwc', `process.exit(0);`);
    await expect(isPwcAvailable(bin)).resolves.toBe(true);
  });
});

describe('pwcSearch', () => {
  it('invokes search with limit/mode/json and maps arxiv hits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwc-search-'));
    const argsPath = join(dir, 'argv.txt');
    const payload = {
      schema_version: 'v1',
      data: {
        results: [
          {
            arxiv_id: '2401.12345v2',
            title: 'Hello',
            abstract: 'Abs one',
            url_abs: 'https://arxiv.org/abs/2401.12345',
          },
          {
            id: '999',
            title: 'No arxiv',
            abstract: 'skip me',
          },
          {
            arxiv_id: '2401.99999',
            title: 'No abstract',
            abstract: '',
          },
        ],
      },
    };
    const bin = writeExecutable(
      dir,
      'pwc',
      `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argsPath)}, process.argv.slice(2).join('\\n'));
process.stdout.write(${JSON.stringify(JSON.stringify(payload))});
`,
    );

    const hits = await pwcSearch('trajectory triage', { bin, limit: 10, mode: 'hybrid', timeoutMs: 2000 });

    expect(readFileSync(argsPath, 'utf8')).toBe(
      ['search', 'trajectory triage', '--limit', '10', '--mode', 'hybrid', '--json'].join('\n'),
    );
    expect(hits).toEqual([
      {
        arxivId: '2401.12345',
        title: 'Hello',
        abstract: 'Abs one',
        url: 'https://arxiv.org/abs/2401.12345',
      },
    ]);
  });

  it('accepts data as a bare list and synthesizes abs url when missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwc-list-'));
    const payload = {
      schema_version: 'v1',
      data: [{ arxiv_id: '1706.03762', title: 'Attention', abstract: 'Transformers' }],
    };
    const bin = writeExecutable(
      dir,
      'pwc',
      `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`,
    );
    const hits = await pwcSearch('attention', { bin, timeoutMs: 2000 });
    expect(hits).toEqual([
      {
        arxivId: '1706.03762',
        title: 'Attention',
        abstract: 'Transformers',
        url: 'https://arxiv.org/abs/1706.03762',
      },
    ]);
  });

  it('throws PWC_NOT_FOUND for missing binary', async () => {
    await expect(pwcSearch('q', { bin: join(tmpdir(), 'missing-pwc'), timeoutMs: 500 })).rejects.toMatchObject({
      code: 'PWC_NOT_FOUND',
    });
  });

  it('throws PWC_EXIT on non-zero exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwc-exit-'));
    const bin = writeExecutable(dir, 'pwc', `process.stderr.write('boom'); process.exit(3);`);
    await expect(pwcSearch('q', { bin, timeoutMs: 2000 })).rejects.toMatchObject({ code: 'PWC_EXIT' });
  });

  it('throws PWC_BAD_JSON on garbage stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwc-bad-'));
    const bin = writeExecutable(dir, 'pwc', `process.stdout.write('not-json');`);
    await expect(pwcSearch('q', { bin, timeoutMs: 2000 })).rejects.toMatchObject({ code: 'PWC_BAD_JSON' });
  });
});
