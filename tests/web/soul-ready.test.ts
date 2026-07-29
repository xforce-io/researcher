import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { scaffoldTopicRepo } from '../../src/commands/init.js';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../../src/paths.js';
import { assessSoulReady, isSoulReady } from '../../src/web/soul-ready.js';

function initTopic(): string {
  const dir = mkdtempSync(join(tmpdir(), 'r-soul-ready-'));
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  scaffoldTopicRepo({ repoRoot: dir });
  return dir;
}

function writeOneline(dir: string, oneline: string): void {
  const py = join(resolveProjectResearcherDir(dir), 'project.yaml');
  writeFileSync(
    py,
    readFileSync(py, 'utf8').replace(/^([ \t]*topic_oneline:[ \t]*).*$/m, `$1"${oneline}"`),
  );
}

function readyYaml(oneline: string): string {
  return [
    'meta:',
    `  topic_oneline: "${oneline}"`,
    '  language: zh',
    'research_questions:',
    '  - id: RQ1',
    '    text: "How should agent post-training choose trajectories?"',
    'inclusion_criteria:',
    '  - "Method contribution on agent training"',
    'exclusion_criteria:',
    '  - "Pure benchmark dump"',
    'sources:',
    '  - kind: arxiv',
    '    queries:',
    '      - "agentic reinforcement learning"',
    '    priority: high',
    'paper_axes: []',
    'cadence:',
    '  default_interval_days: 7',
    '  backoff_after_empty_runs: 3',
    '',
  ].join('\n');
}

function readyThesis(): string {
  return [
    '# Thesis',
    '',
    '## Working thesis',
    '',
    'Agent post-training should prioritize trajectory triage before preference optimization.',
    'Falsifier: a system that skips triage and still beats triage pipelines on cost-normalized win rate.',
    '',
    '## Taste',
    '',
    '- Prefer mechanism papers over leaderboard-only reports.',
    '',
    '## Anti-patterns',
    '',
    '- Benchmark-only papers without a method.',
    '',
  ].join('\n');
}

describe('assessSoulReady / isSoulReady (#106)', () => {
  let dir: string;
  beforeEach(() => {
    dir = initTopic();
  });

  it('rejects pristine scaffold as not ready', () => {
    const r = assessSoulReady(dir);
    expect(r.ready).toBe(false);
    expect(isSoulReady(dir)).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.hasOpenQuestions).toBe(false);
  });

  it('rejects scaffold with only topic_oneline filled', () => {
    writeOneline(dir, 'agentic model training领域进展研究');
    const r = assessSoulReady(dir);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => /thesis|template|hollow/i.test(x))).toBe(true);
    expect(r.reasons.some((x) => /quer(y|ies)|source/i.test(x))).toBe(true);
  });

  it('rejects shallow onboard: template thesis anchors + oneline-derived queries only look filled', () => {
    // Mirrors agentic-model-training after weak onboard: thesis still instructional,
    // queries are a single broad phrase, RQ boilerplate from oneline.
    const dot = resolveProjectResearcherDir(dir);
    writeFileSync(
      join(dot, 'project.yaml'),
      [
        'meta:',
        '  topic_oneline: "agentic model training领域进展研究"',
        '  language: zh',
        'research_questions:',
        '  - id: RQ1',
        '    text: "How is the state of the art currently defined for: agentic model training领域进展研究?"',
        'inclusion_criteria:',
        '  - "Must address one of the research questions above."  # TODO: revisit after first few papers',
        'exclusion_criteria:',
        '  - "Pure benchmark papers without methodological contribution."',
        'sources:',
        '  - kind: arxiv',
        '    queries:',
        '      - "agentic model training"',
        '    priority: high',
        'paper_axes: []',
        'cadence:',
        '  default_interval_days: 7',
        '  backoff_after_empty_runs: 3',
        '',
      ].join('\n'),
    );
    // thesis: not byte-equal to template (em-dash normalized) but still hollow
    const tmpl = readFileSync(join(resolvePackageRoot(), 'templates/thesis.md'), 'utf8');
    writeFileSync(
      join(dot, 'thesis.md'),
      tmpl
        .replaceAll('—', '-')
        .replace(
          '## Design Context\n\nWhat are you building or deciding? Name the artifact, the specific gap, and\nwhat success looks like in concrete terms. Leave blank if this is purely\nexploratory research.\n',
          '<!-- TODO: revisit after first few papers -->\n',
        ),
    );

    const r = assessSoulReady(dir);
    expect(r.ready).toBe(false);
    expect(isThesisStillHollow(r)).toBe(true);
  });

  it('rejects when open_questions.md exists even if yaml/thesis look filled', () => {
    const dot = resolveProjectResearcherDir(dir);
    writeFileSync(join(dot, 'project.yaml'), readyYaml('filled'));
    writeFileSync(join(dot, 'thesis.md'), readyThesis());
    writeFileSync(join(dot, 'open_questions.md'), '# Open Questions\n\n1. What sub-area?\n');

    const r = assessSoulReady(dir);
    expect(r.ready).toBe(false);
    expect(r.hasOpenQuestions).toBe(true);
    expect(r.reasons.some((x) => /open_questions/i.test(x))).toBe(true);
  });

  it('accepts real thesis + non-placeholder arxiv queries', () => {
    const dot = resolveProjectResearcherDir(dir);
    writeFileSync(join(dot, 'project.yaml'), readyYaml('agent post-training'));
    writeFileSync(join(dot, 'thesis.md'), readyThesis());

    const r = assessSoulReady(dir);
    expect(r.ready).toBe(true);
    expect(isSoulReady(dir)).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.hasOpenQuestions).toBe(false);
  });

  it('accepts x-inbox source with inbox_dir even without arxiv queries', () => {
    const dot = resolveProjectResearcherDir(dir);
    writeFileSync(
      join(dot, 'project.yaml'),
      [
        'meta:',
        '  topic_oneline: "feed pillar"',
        '  language: zh',
        'research_questions:',
        '  - id: RQ1',
        '    text: "What signals matter this week?"',
        'inclusion_criteria: []',
        'exclusion_criteria: []',
        'sources:',
        '  - kind: x-inbox',
        '    inbox_dir: "~/.researcher-invest-feeds/inbox"',
        'cadence:',
        '  default_interval_days: 7',
        '  backoff_after_empty_runs: 3',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dot, 'thesis.md'), readyThesis());
    expect(isSoulReady(dir)).toBe(true);
  });

  it('rejects placeholder arxiv query your topic keyword', () => {
    const dot = resolveProjectResearcherDir(dir);
    writeFileSync(
      join(dot, 'project.yaml'),
      [
        'meta:',
        '  topic_oneline: "x"',
        '  language: zh',
        'research_questions:',
        '  - id: RQ1',
        '    text: "real question about mechanisms"',
        'inclusion_criteria: []',
        'exclusion_criteria: []',
        'sources:',
        '  - kind: arxiv',
        '    queries:',
        '      - "your topic keyword"',
        'cadence:',
        '  default_interval_days: 7',
        '  backoff_after_empty_runs: 3',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dot, 'thesis.md'), readyThesis());
    expect(isSoulReady(dir)).toBe(false);
  });
});

function isThesisStillHollow(r: { reasons: string[] }): boolean {
  return r.reasons.some((x) => /thesis|template|hollow/i.test(x));
}
