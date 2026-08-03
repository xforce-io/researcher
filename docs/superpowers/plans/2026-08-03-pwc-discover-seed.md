# pwc Discover Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the discover collect agent runs, optionally seed `discover-candidates.json` from host-side `pwc search --json` using `project.yaml` queries, soft-degrading when `pwc` is missing.

**Architecture:** A thin `src/sources/pwc.ts` exec wrapper talks to the optional `pwc` binary. `src/pipeline/discover_seed.ts` maps search hits into the existing discover-candidates schema (arxiv-only), writes a seed handoff, and returns a report. `discover_triage.ts` calls seed only when no valid candidates file exists yet, then runs collect with seed-aware prompt values. Triage and downstream stages stay unchanged.

**Tech Stack:** TypeScript ESM, Zod (existing discover-candidates schema), execa, Vitest, Node fs/path.

**Spec:** `docs/superpowers/specs/2026-08-03-pwc-discover-seed-design.md`

## Global Constraints

- `pwc` is optional; missing binary / per-query failure must not fail the discover stage.
- v1 host commands: only `pwc search <q> --limit 10 --mode hybrid --json` (plus optional `pwc version` for availability).
- Only candidates with a resolvable arXiv id are kept; `source` is always `"arxiv"`.
- Seed query cap: first 5 non-empty real queries (yaml order). Per-query limit: 10. Global seed cap: 20.
- Skip placeholder query `"your topic keyword"` (same as `hasPaperDiscoveryQueries`).
- Skip `kind: x-inbox`. Include other kinds that have keyword `queries[]` for search (v1 does not implement citation follow).
- If a valid `discover-candidates.json` already exists, do not overwrite (resume short-circuit unchanged).
- Always write a seed file when seed runs (including empty candidates + summary) so collect can see seed state.
- Use argv `execa` arrays; never shell-interpolate queries.
- Do not change triage schema, Library, feed path, or `--discover` opt-in policy.
- `RESEARCHER_PWC_BIN` overrides the binary name/path; default `pwc`.

## File map

| File | Responsibility |
|---|---|
| `src/sources/pwc.ts` | availability + search exec + JSON row parse |
| `src/pipeline/discover_seed.ts` | queries → map/dedupe/cap → write handoff |
| `src/pipeline/discover_triage.ts` | call seed before collect; pass seed prompt values |
| `prompts/stage-discover-collect.md` | seed-aware collect instructions |
| `methodology/02-source.md` | document optional host pwc seed |
| `README.md` / `README.zh-CN.md` | optional `pwc` dependency |
| `tests/sources/pwc.test.ts` | CLI wrapper unit tests |
| `tests/pipeline/discover_seed.test.ts` | seed orchestration unit tests |
| `tests/pipeline/discover_triage.test.ts` | integration: seed then collect prompt |

---

### Task 1: `pwc` CLI wrapper

**Files:**
- Create: `src/sources/pwc.ts`
- Create: `tests/sources/pwc.test.ts`

**Interfaces:**
- Consumes: `execa`, `canonicalizeArxivId` / `arxivAbsUrl` from `src/sources/arxiv.ts` (only if mapping lives here — prefer pure search rows here, mapping in seed; see Produces).
- Produces:
  ```ts
  export type PwcSearchHit = {
    arxivId: string; // bare, no arxiv: prefix, version stripped by canonicalize
    title: string;
    abstract: string;
    url: string;
  };

  export class PwcError extends Error {
    constructor(
      message: string,
      public readonly code: 'PWC_NOT_FOUND' | 'PWC_EXIT' | 'PWC_TIMEOUT' | 'PWC_BAD_JSON',
      public readonly cause?: unknown,
    );
  }

  export function resolvePwcBin(): string; // process.env.RESEARCHER_PWC_BIN?.trim() || 'pwc'
  export async function isPwcAvailable(bin?: string): Promise<boolean>;
  export async function pwcSearch(
    query: string,
    opts?: { bin?: string; limit?: number; mode?: 'hybrid' | 'keyword' | 'semantic'; timeoutMs?: number },
  ): Promise<PwcSearchHit[]>;
  ```
- `pwcSearch` throws `PwcError` on hard failures for **that call**. Callers soft-degrade.
- Rows without usable arXiv id / title / abstract are omitted from the returned array (not thrown).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/sources/pwc.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sources/pwc.test.ts`

Expected: FAIL — cannot resolve `../../src/sources/pwc.js`.

- [ ] **Step 3: Implement `src/sources/pwc.ts`**

```ts
import { execa } from 'execa';
import { arxivAbsUrl, canonicalizeArxivId } from './arxiv.js';

const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 45_000;

export type PwcSearchHit = {
  arxivId: string;
  title: string;
  abstract: string;
  url: string;
};

export class PwcError extends Error {
  constructor(
    message: string,
    public readonly code: 'PWC_NOT_FOUND' | 'PWC_EXIT' | 'PWC_TIMEOUT' | 'PWC_BAD_JSON',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PwcError';
  }
}

export function resolvePwcBin(): string {
  const fromEnv = process.env.RESEARCHER_PWC_BIN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'pwc';
}

export async function isPwcAvailable(bin = resolvePwcBin()): Promise<boolean> {
  try {
    const result = await execa(bin, ['version'], { timeout: 10_000, reject: false });
    if ('code' in result && result.code === 'ENOENT') return false;
    return result.exitCode === 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') return false;
    return false;
  }
}

export async function pwcSearch(
  query: string,
  opts: {
    bin?: string;
    limit?: number;
    mode?: 'hybrid' | 'keyword' | 'semantic';
    timeoutMs?: number;
  } = {},
): Promise<PwcSearchHit[]> {
  const bin = opts.bin ?? resolvePwcBin();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const mode = opts.mode ?? 'hybrid';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const q = query.trim();
  if (!q) return [];

  let result: Awaited<ReturnType<typeof execa>>;
  try {
    result = await execa(bin, ['search', q, '--limit', String(limit), '--mode', mode, '--json'], {
      timeout: timeoutMs,
      reject: false,
    });
  } catch (error) {
    throw mapSpawnError(error);
  }

  if ('code' in result && result.code === 'ENOENT') {
    throw new PwcError(`pwc executable not found: ${bin}`, 'PWC_NOT_FOUND');
  }
  if (result.timedOut) {
    throw new PwcError(`pwc search timed out for query: ${q}`, 'PWC_TIMEOUT');
  }
  if (result.exitCode !== 0) {
    throw new PwcError(
      `pwc search exited ${result.exitCode ?? 1}: ${(result.stderr || result.stdout || '').slice(0, 200)}`,
      'PWC_EXIT',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch (error) {
    throw new PwcError('pwc search returned non-JSON stdout', 'PWC_BAD_JSON', error);
  }

  const rows = extractRows(parsed);
  const hits: PwcSearchHit[] = [];
  for (const row of rows) {
    const hit = mapRow(row);
    if (hit) hits.push(hit);
  }
  return hits;
}

function extractRows(parsed: unknown): Record<string, unknown>[] {
  // Prefer { schema_version, data } wrapper; also accept bare data shapes.
  let data: unknown = parsed;
  if (parsed && typeof parsed === 'object' && 'data' in parsed) {
    data = (parsed as { data: unknown }).data;
  }
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const list = obj.results ?? obj.items;
    if (Array.isArray(list)) {
      return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    }
  }
  throw new PwcError('pwc search JSON missing result list', 'PWC_BAD_JSON');
}

function mapRow(row: Record<string, unknown>): PwcSearchHit | null {
  const title = String(row.title ?? '').trim();
  const abstract = String(row.abstract ?? '').trim();
  if (!title || !abstract) return null;

  const arxivRaw = row.arxiv_id ?? row.arxivId;
  let canonical: string;
  try {
    canonical = canonicalizeArxivId(String(arxivRaw ?? row.id ?? ''));
  } catch {
    return null;
  }
  const bare = canonical.replace(/^arxiv:/, '');
  const urlRaw = String(row.url_abs ?? row.source_url ?? row.url ?? '').trim();
  const url = urlRaw || arxivAbsUrl(canonical);
  try {
    // Validate URL shape early; discover-candidates zod requires url().
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return null;
  }
  return { arxivId: bare, title, abstract, url };
}

function mapSpawnError(error: unknown): PwcError {
  const processError = error as { code?: unknown; timedOut?: unknown };
  if (processError.code === 'ENOENT') {
    return new PwcError('pwc executable not found', 'PWC_NOT_FOUND', error);
  }
  if (processError.timedOut === true) {
    return new PwcError('pwc search timed out', 'PWC_TIMEOUT', error);
  }
  return new PwcError('pwc search failed to start', 'PWC_EXIT', error);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sources/pwc.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/pwc.ts tests/sources/pwc.test.ts
git commit -m "feat(sources): add optional pwc search CLI wrapper"
```

---

### Task 2: Discover seed orchestration

**Files:**
- Create: `src/pipeline/discover_seed.ts`
- Create: `tests/pipeline/discover_seed.test.ts`

**Interfaces:**
- Consumes: `pwcSearch`, `isPwcAvailable`, `resolvePwcBin`, `PwcSearchHit` from `src/sources/pwc.ts`; `DiscoverCandidates` / `parseDiscoverCandidates` from `src/config/discover-candidates.ts`; `loadProjectYaml` from `src/config/project-yaml.ts`.
- Produces:
  ```ts
  export const PLACEHOLDER_QUERY = 'your topic keyword'; // mirror run-source-mode
  export const SEED_QUERY_CAP = 5;
  export const SEED_PER_QUERY_LIMIT = 10;
  export const SEED_GLOBAL_CAP = 20;

  export type DiscoverSeedReport = {
    attempted: boolean;
    available: boolean;
    queries: string[];
    candidateCount: number;
    skippedReason?: string; // e.g. 'pwc_unavailable' | 'no_queries' | 'all_queries_failed'
    warnings: string[];
  };

  export async function seedDiscoverCandidates(opts: {
    projectYamlPath: string;
    candidatesPath: string;
    seenIds: ReadonlySet<string> | readonly string[];
    language: string;
    /** inject for tests */
    search?: typeof pwcSearch;
    available?: typeof isPwcAvailable;
    bin?: string;
  }): Promise<DiscoverSeedReport>;
  ```
- Behavior:
  - Collect queries: sources where `kind !== 'x-inbox'`, `queries` non-empty after trim, not placeholder; preserve order; unique by exact string; slice to 5.
  - If no queries → `{ attempted:false, available:false, queries:[], candidateCount:0, skippedReason:'no_queries', warnings:[] }` and **do not write** a file.
  - If `available()` false → write empty candidates file with summary explaining soft-degrade; return `skippedReason:'pwc_unavailable'`.
  - Else for each query call `search`; on throw push warning and continue.
  - Map hits → `{ id: 'arxiv:'+arxivId, title, url, abstract, source:'arxiv' }`; drop if id in seen; dedupe by id; cap 20.
  - Write JSON pretty-printed with `search_summary` in `language` (`zh` vs default en templates below).
  - `attempted: true` whenever seed logic ran past query collection (including unavailable / all failed).

`search_summary` templates:

- en empty unavailable: `Host pwc seed skipped: pwc not available on PATH. Collect agent should discover without host seed.`
- en empty zero hits: `Host pwc seed ran queries: <q1 | q2>. No new arxiv candidates after filters.`
- en with hits: `Host pwc seed: N arxiv candidates from queries: <...>.`
- zh equivalents (简体).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pipeline/discover_seed.test.ts
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseDiscoverCandidates } from '../../src/config/discover-candidates.js';
import { seedDiscoverCandidates } from '../../src/pipeline/discover_seed.js';
import type { PwcSearchHit } from '../../src/sources/pwc.js';

function writeProject(dir: string, yaml: string): string {
  const researcher = join(dir, '.researcher');
  mkdirSync(researcher, { recursive: true });
  const path = join(researcher, 'project.yaml');
  writeFileSync(path, yaml);
  return path;
}

const baseYaml = `meta: { language: en }
research_questions: [{ id: RQ1, text: q }]
inclusion_criteria: []
exclusion_criteria: []
sources:
  - kind: arxiv
    queries:
      - "trajectory triage"
      - "your topic keyword"
      - "agent eval"
      - "q3"
      - "q4"
      - "q5"
      - "q6-should-drop"
  - kind: x-inbox
    queries: ["should ignore"]
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
`;

describe('seedDiscoverCandidates', () => {
  it('soft-degrades when pwc is unavailable and writes empty handoff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-unavail-'));
    const yamlPath = writeProject(dir, baseYaml);
    const candidatesPath = join(dir, 'discover-candidates.json');

    const report = await seedDiscoverCandidates({
      projectYamlPath: yamlPath,
      candidatesPath,
      seenIds: [],
      language: 'en',
      available: async () => false,
      search: async () => {
        throw new Error('should not search');
      },
    });

    expect(report).toMatchObject({
      attempted: true,
      available: false,
      candidateCount: 0,
      skippedReason: 'pwc_unavailable',
    });
    expect(report.queries).toEqual([
      'trajectory triage',
      'agent eval',
      'q3',
      'q4',
      'q5',
    ]);
    const parsed = parseDiscoverCandidates(readFileSync(candidatesPath, 'utf8'));
    expect(parsed.candidates).toEqual([]);
    expect(parsed.search_summary).toMatch(/pwc not available/i);
  });

  it('maps search hits, drops seen, dedupes, caps at 20, and ignores x-inbox/placeholder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-map-'));
    const yamlPath = writeProject(dir, baseYaml);
    const candidatesPath = join(dir, 'discover-candidates.json');

    const search = vi.fn(async (query: string): Promise<PwcSearchHit[]> => {
      if (query === 'trajectory triage') {
        return [
          {
            arxivId: '2401.00001',
            title: 'A',
            abstract: 'abs A',
            url: 'https://arxiv.org/abs/2401.00001',
          },
          {
            arxivId: '2401.00002',
            title: 'B',
            abstract: 'abs B',
            url: 'https://arxiv.org/abs/2401.00002',
          },
        ];
      }
      if (query === 'agent eval') {
        return [
          {
            arxivId: '2401.00002', // dup
            title: 'B again',
            abstract: 'abs B2',
            url: 'https://arxiv.org/abs/2401.00002',
          },
          {
            arxivId: '2401.00003',
            title: 'C',
            abstract: 'abs C',
            url: 'https://arxiv.org/abs/2401.00003',
          },
        ];
      }
      return Array.from({ length: 10 }, (_, i) => ({
        arxivId: `2401.1${query.slice(-1)}${i}0`,
        title: `${query}-${i}`,
        abstract: `abs ${query} ${i}`,
        url: `https://arxiv.org/abs/2401.1${query.slice(-1)}${i}0`,
      }));
    });

    const report = await seedDiscoverCandidates({
      projectYamlPath: yamlPath,
      candidatesPath,
      seenIds: ['arxiv:2401.00001'],
      language: 'en',
      available: async () => true,
      search,
    });

    expect(search).toHaveBeenCalled();
    // placeholder and q6 excluded; only 5 queries
    expect(report.queries).toHaveLength(5);
    expect(report.queries).not.toContain('your topic keyword');
    expect(report.queries).not.toContain('q6-should-drop');

    const parsed = parseDiscoverCandidates(readFileSync(candidatesPath, 'utf8'));
    expect(parsed.candidates.some((c) => c.id === 'arxiv:2401.00001')).toBe(false);
    expect(parsed.candidates.filter((c) => c.id === 'arxiv:2401.00002')).toHaveLength(1);
    expect(parsed.candidates.length).toBeLessThanOrEqual(20);
    expect(parsed.candidates.every((c) => c.source === 'arxiv' && c.id.startsWith('arxiv:'))).toBe(true);
    expect(report.candidateCount).toBe(parsed.candidates.length);
    expect(report.skippedReason).toBeUndefined();
  });

  it('continues after a single query failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-partial-'));
    const yamlPath = writeProject(
      dir,
      `meta: { language: en }
research_questions: [{ id: RQ1, text: q }]
inclusion_criteria: []
exclusion_criteria: []
sources:
  - kind: arxiv
    queries: ["bad", "good"]
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
`,
    );
    const candidatesPath = join(dir, 'discover-candidates.json');
    const report = await seedDiscoverCandidates({
      projectYamlPath: yamlPath,
      candidatesPath,
      seenIds: [],
      language: 'en',
      available: async () => true,
      search: async (q) => {
        if (q === 'bad') throw Object.assign(new Error('exit 3'), { code: 'PWC_EXIT' });
        return [
          {
            arxivId: '2401.77777',
            title: 'Good',
            abstract: 'ok',
            url: 'https://arxiv.org/abs/2401.77777',
          },
        ];
      },
    });
    expect(report.candidateCount).toBe(1);
    expect(report.warnings.length).toBeGreaterThan(0);
    const parsed = parseDiscoverCandidates(readFileSync(candidatesPath, 'utf8'));
    expect(parsed.candidates[0]?.id).toBe('arxiv:2401.77777');
  });

  it('returns no_queries without writing when only placeholders/inbox exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-none-'));
    const yamlPath = writeProject(
      dir,
      `meta: { language: en }
research_questions: [{ id: RQ1, text: q }]
inclusion_criteria: []
exclusion_criteria: []
sources:
  - kind: arxiv
    queries: ["your topic keyword"]
  - kind: x-inbox
    inbox_dir: ~/inbox
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
`,
    );
    const candidatesPath = join(dir, 'discover-candidates.json');
    const report = await seedDiscoverCandidates({
      projectYamlPath: yamlPath,
      candidatesPath,
      seenIds: [],
      language: 'en',
      available: async () => true,
      search: async () => [],
    });
    expect(report).toMatchObject({ attempted: false, skippedReason: 'no_queries', candidateCount: 0 });
    expect(() => readFileSync(candidatesPath, 'utf8')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pipeline/discover_seed.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/pipeline/discover_seed.ts`**

Implement exactly to the interface above. Key body sketch:

```ts
import { writeFileSync } from 'node:fs';
import { loadProjectYaml } from '../config/project-yaml.js';
import type { DiscoverCandidate, DiscoverCandidates } from '../config/discover-candidates.js';
import { isPwcAvailable, pwcSearch, resolvePwcBin, type PwcSearchHit } from '../sources/pwc.js';

export const PLACEHOLDER_QUERY = 'your topic keyword';
export const SEED_QUERY_CAP = 5;
export const SEED_PER_QUERY_LIMIT = 10;
export const SEED_GLOBAL_CAP = 20;

// ... types ...

export async function seedDiscoverCandidates(opts: { /* ... */ }): Promise<DiscoverSeedReport> {
  const cfg = loadProjectYaml(opts.projectYamlPath);
  const queries = collectQueries(cfg.sources);
  if (queries.length === 0) {
    return { attempted: false, available: false, queries: [], candidateCount: 0, skippedReason: 'no_queries', warnings: [] };
  }

  const bin = opts.bin ?? resolvePwcBin();
  const availableFn = opts.available ?? isPwcAvailable;
  const searchFn = opts.search ?? pwcSearch;
  const warnings: string[] = [];
  const available = await availableFn(bin);
  if (!available) {
    writeHandoff(opts.candidatesPath, [], summaryUnavailable(opts.language));
    return { attempted: true, available: false, queries, candidateCount: 0, skippedReason: 'pwc_unavailable', warnings };
  }

  const seen = toSeenSet(opts.seenIds);
  const byId = new Map<string, DiscoverCandidate>();
  let anySuccess = false;
  for (const q of queries) {
    try {
      const hits = await searchFn(q, { bin, limit: SEED_PER_QUERY_LIMIT, mode: 'hybrid' });
      anySuccess = true;
      for (const hit of hits) {
        const c = hitToCandidate(hit);
        if (seen.has(c.id) || byId.has(c.id)) continue;
        byId.set(c.id, c);
        if (byId.size >= SEED_GLOBAL_CAP) break;
      }
    } catch (error) {
      warnings.push(`pwc search failed for ${JSON.stringify(q)}: ${(error as Error).message}`);
    }
    if (byId.size >= SEED_GLOBAL_CAP) break;
  }

  const candidates = [...byId.values()];
  const summary =
    candidates.length === 0
      ? summaryEmpty(opts.language, queries, anySuccess)
      : summaryHits(opts.language, queries, candidates.length);
  writeHandoff(opts.candidatesPath, candidates, summary);

  return {
    attempted: true,
    available: true,
    queries,
    candidateCount: candidates.length,
    skippedReason: candidates.length === 0 && !anySuccess ? 'all_queries_failed' : undefined,
    warnings,
  };
}

function hitToCandidate(hit: PwcSearchHit): DiscoverCandidate {
  return {
    id: `arxiv:${hit.arxivId}`,
    title: hit.title,
    url: hit.url,
    abstract: hit.abstract,
    source: 'arxiv',
  };
}

function writeHandoff(path: string, candidates: DiscoverCandidate[], search_summary: string): void {
  const body: DiscoverCandidates = { candidates, search_summary };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}
```

Fill `collectQueries`, `toSeenSet`, and the four summary helpers. `collectQueries` must skip `x-inbox`, empty, placeholder; dedupe exact strings; cap 5.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pipeline/discover_seed.test.ts`

Expected: PASS. If the cap test is flaky because synthetic arxiv ids fail `DiscoverCandidateSchema` regex, fix the test factory to emit ids matching `^\d{4}\.\d{4,5}$` only (e.g. `2401.10001`, `2401.10002`, …).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/discover_seed.ts tests/pipeline/discover_seed.test.ts
git commit -m "feat(pipeline): seed discover candidates via pwc search"
```

---

### Task 3: Wire seed into discover collect + prompt

**Files:**
- Modify: `src/pipeline/discover_triage.ts`
- Modify: `prompts/stage-discover-collect.md`
- Modify: `tests/pipeline/discover_triage.test.ts`

**Interfaces:**
- Consumes: `seedDiscoverCandidates`, `DiscoverSeedReport` from `./discover_seed.js`.
- Produces: unchanged `discoverTriage(ctx)` export; collect prompt gains `{{seed_status}}`.

- [ ] **Step 1: Add failing integration assertions to discover_triage tests**

In `tests/pipeline/discover_triage.test.ts`, add a test that:

1. Builds the same temp topic fixture the file already uses (`runInit` + methodology + thesis/yaml).
2. Sets `RESEARCHER_PWC_BIN` to a fake executable that prints one valid pwc JSON hit for any `search`.
3. Uses an adapter whose collect handler **refuses to write** if the candidates file already has ≥1 candidate — instead records `opts.userPrompt` and returns ok; triage still returns a valid triaged JSON that deep-reads the seeded id or rejects cleanly.
4. Asserts:
   - after `discoverTriage`, `discover-candidates.json` existed with the seeded arxiv id before/without collect overwriting (or final file still contains seed id if collect merges);
   - collect `userPrompt` includes seed status text (e.g. `/Host pwc seed/i` or `/seed/i` and the query string);
   - collect prompt includes an instruction not to repeat the same seeded queries.

Also add a test with `RESEARCHER_PWC_BIN` pointing at a missing path: discover still succeeds with stub collect (existing behavior), and collect prompt mentions unavailable/empty seed **or** simply runs without throwing.

Sketch for fake pwc (node executable):

```js
// if argv includes 'version' -> exit 0
// if argv[2]==='search' -> stdout JSON one hit arxiv 2401.54321
```

Adapter collect:

```ts
if (opts.agentId === 'researcher-collect') {
  const candidatePath = /`([^`]+discover-candidates\.json)`/.exec(opts.userPrompt)?.[1];
  // read existing seed if present
  this.collectPrompt = opts.userPrompt;
  if (candidatePath && existsSync(candidatePath)) {
    const existing = JSON.parse(readFileSync(candidatePath, 'utf8'));
    if (Array.isArray(existing.candidates) && existing.candidates.length > 0) {
      return { output: 'kept-seed', modifiedFiles: [], exitCode: 0 };
    }
  }
  // fallback write minimal collected...
}
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx vitest run tests/pipeline/discover_triage.test.ts -t "pwc seed"`

Expected: FAIL (no seed wiring / no seed_status in prompt).

- [ ] **Step 3: Update `prompts/stage-discover-collect.md`**

After `## Discovery budget` (or before Output), insert:

```markdown
## Host seed status

{{seed_status}}

Rules when a host seed is present:
- Start from the existing candidates already written at `{{candidates_path}}` (host pwc seed). Merge; do not discard them.
- Do **not** re-run `pwc search` or equivalent arXiv search for the same queries the host already seeded.
- Prefer: fill missing abstracts via `pwc paper info <id> --json` when useful; add **new** mechanism-specific queries only for thesis/landscape gaps not covered by the seed.
- Still obey the discovery budget and final JSON shape. Final candidates must remain schema-valid.
- If the seed is empty or pwc was unavailable, behave as before (plan 3–5 queries and search).
```

- [ ] **Step 4: Wire `loadCollectedCandidates` in `discover_triage.ts`**

Inside `loadCollectedCandidates`, **before** the collect agent invoke, when `!existsSync(candidatesPath)` (or after failed validate that falls through):

```ts
import { seedDiscoverCandidates } from './discover_seed.js';

// ...
const seedReport = await seedDiscoverCandidates({
  projectYamlPath: join(ctx.researcherDir, 'project.yaml'),
  candidatesPath,
  seenIds: listSeenIds(seenPath), // or pass from caller
  language: values.language,
});

const seed_status = formatSeedStatus(seedReport, values.language);

const collectPrompt = renderTemplate(loadPromptTemplate('stage-discover-collect.md'), {
  ...values,
  candidates_path: candidatesPath,
  seed_status,
});
```

If a valid candidates file already exists at the top of `loadCollectedCandidates`, return it **without** seeding (current short-circuit).

`formatSeedStatus` can live in `discover_triage.ts` or `discover_seed.ts`:

```ts
function formatSeedStatus(report: DiscoverSeedReport, language: string): string {
  if (!report.attempted) {
    return language === 'zh'
      ? '宿主未执行 pwc 种子（无有效 queries）。按原发现预算自行检索。'
      : 'No host pwc seed (no real queries). Discover under the normal budget.';
  }
  if (!report.available) {
    return language === 'zh'
      ? `宿主 pwc 不可用（软降级）。queries: ${report.queries.join(' | ') || '（无）'}。按原预算自行检索。`
      : `Host pwc unavailable (soft-degraded). queries: ${report.queries.join(' | ') || '(none)'}. Discover under the normal budget.`;
  }
  return language === 'zh'
    ? `宿主 pwc 种子已写入 ${report.candidateCount} 条。queries: ${report.queries.join(' | ')}。警告: ${report.warnings.join('; ') || '无'}。合并种子，勿重复同一 query。`
    : `Host pwc seed wrote ${report.candidateCount} candidates. queries: ${report.queries.join(' | ')}. warnings: ${report.warnings.join('; ') || 'none'}. Merge the seed; do not repeat those queries.`;
}
```

Pass `seenPath` into `loadCollectedCandidates` or re-read seen ids there — match existing style (currently `listSeenIds` is local).

Log one line to stdout optional: `process.stderr.write` or existing run logging if any; do not fail on log.

- [ ] **Step 5: Run discover_triage tests**

Run: `npx vitest run tests/pipeline/discover_triage.test.ts`

Expected: PASS (including new pwc seed cases). Fix any stub that assumed collect always creates the file from scratch — seed may pre-create it.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/discover_triage.ts prompts/stage-discover-collect.md tests/pipeline/discover_triage.test.ts
git commit -m "feat(discover): seed collect from host pwc search"
```

---

### Task 4: Docs (methodology + README)

**Files:**
- Modify: `methodology/02-source.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Produces: operator-facing documentation only.

- [ ] **Step 1: Update methodology arXiv / retrieval section**

In `methodology/02-source.md`, under **arXiv.** query strategy paragraph, append:

```markdown
**Host seed (optional).** When the `pwc` CLI ([paperswithcode/pwc-cli](https://github.com/huggingface/pwc-cli)) is on `PATH`, the Researcher host runs `pwc search <query> --json` for each real `sources[].queries` entry (cap 5 queries, 10 hits each, 20 seeded candidates) **before** the collect agent starts. Only hits with an arXiv id become seed candidates. If `pwc` is missing or fails, discover soft-degrades and the collect agent searches as before. The collect agent must not repeat the same seeded queries; it may add gap-filling queries and enrich abstracts.
```

- [ ] **Step 2: Update README dependency lists**

English `README.md` dependencies bullet list — add:

```markdown
- Optional: `pwc` CLI on `PATH` ([pwc-cli](https://github.com/huggingface/pwc-cli)) — host-side discover seed via `pwc search --json`. Without it, discover collect behaves as before.
```

Chinese `README.zh-CN.md` matching bullet:

```markdown
- 可选：`PATH` 上的 `pwc` CLI（[pwc-cli](https://github.com/huggingface/pwc-cli)）——宿主在 discover 阶段用 `pwc search --json` 预置候选。缺失时 collect 行为与原来一致（软降级）。
```

- [ ] **Step 3: Commit**

```bash
git add methodology/02-source.md README.md README.zh-CN.md
git commit -m "docs: optional pwc host seed for discover"
```

---

### Task 5: Full verification

**Files:** none new

- [ ] **Step 1: Run focused suites**

```bash
npx vitest run tests/sources/pwc.test.ts tests/pipeline/discover_seed.test.ts tests/pipeline/discover_triage.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run full unit suite**

```bash
npm test
```

Expected: PASS. If unrelated flakes appear, re-run once; do not weaken assertions for this feature.

- [ ] **Step 3: Manual smoke (optional, local only)**

If `pwc` is installed:

```bash
pwc version
pwc search "attention is all you need" --limit 2 --json | head -c 500
```

No required CI gate for live pwc.

- [ ] **Step 4: Final commit only if docs/tests fixed during verification**

Otherwise done.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| `src/sources/pwc.ts` wrapper | Task 1 |
| `discover_seed.ts` map/dedupe/cap/soft-degrade | Task 2 |
| Wire before collect; resume short-circuit | Task 3 |
| Prompt seed rules / no repeat queries | Task 3 |
| arxiv-only mapping | Task 1–2 |
| Empty seed file + summary | Task 2 |
| methodology + README optional dep | Task 4 |
| No triage/Library/feed changes | respected (no tasks) |
| related/lineage/trending out of scope | respected |

## Placeholder scan

None intentional. Fake-pwc script bodies and summary strings are fully specified.

## Type consistency

- `PwcSearchHit.arxivId` = bare id; candidate id = `arxiv:${arxivId}`.
- `DiscoverSeedReport.skippedReason`: `no_queries` | `pwc_unavailable` | `all_queries_failed`.
- Prompt placeholder name: `seed_status` only.
