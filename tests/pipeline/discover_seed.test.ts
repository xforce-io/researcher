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
      // Emit valid arxiv ids matching DiscoverCandidateSchema (YYYY.NNNNN)
      const qIndex = ['q3', 'q4', 'q5'].indexOf(query);
      const base = 10000 + Math.max(0, qIndex) * 100;
      return Array.from({ length: 10 }, (_, i) => {
        const n = base + i;
        const arxivId = `2401.${String(n).padStart(5, '0')}`;
        return {
          arxivId,
          title: `${query}-${i}`,
          abstract: `abs ${query} ${i}`,
          url: `https://arxiv.org/abs/${arxivId}`,
        };
      });
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
