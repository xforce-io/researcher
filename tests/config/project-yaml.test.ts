import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectYaml, ProjectYamlError } from '../../src/config/project-yaml.js';

const writeYaml = (yaml: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
  const p = join(dir, 'project.yaml');
  writeFileSync(p, yaml);
  return p;
};

const VALID = `
research_questions:
  - id: RQ1
    text: "How to triage trajectories?"
inclusion_criteria:
  - "Must address one of {RQ1..RQn}"
exclusion_criteria: []
sources:
  - kind: arxiv
    queries: ["agent trajectory"]
    priority: high
paper_axes:
  - name: layer
    values: [infrastructure, triage]
cadence:
  default_interval_days: 7
  backoff_after_empty_runs: 3
`;

describe('loadProjectYaml', () => {
  it('parses a valid project.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID);
    const cfg = loadProjectYaml(p);
    expect(cfg.research_questions).toHaveLength(1);
    expect(cfg.research_questions[0].id).toBe('RQ1');
    expect(cfg.sources[0].kind).toBe('arxiv');
    expect(cfg.cadence.default_interval_days).toBe(7);
  });

  it('throws ProjectYamlError on missing required field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, 'research_questions: []');
    expect(() => loadProjectYaml(p)).toThrow(ProjectYamlError);
  });

  it('defaults meta.language to zh when meta is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID); // VALID has no meta block
    const cfg = loadProjectYaml(p);
    expect(cfg.meta.language).toBe('zh');
  });

  it('reads an explicit meta.language', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID + '\nmeta:\n  language: en\n');
    const cfg = loadProjectYaml(p);
    expect(cfg.meta.language).toBe('en');
  });

  it('defaults delivery.mode to local when delivery is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID); // VALID has no delivery block
    const cfg = loadProjectYaml(p);
    expect(cfg.delivery.mode).toBe('local');
  });

  it('reads an explicit delivery.mode: remote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID + '\ndelivery:\n  mode: remote\n');
    const cfg = loadProjectYaml(p);
    expect(cfg.delivery.mode).toBe('remote');
  });

  it('rejects an unknown delivery.mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID + '\ndelivery:\n  mode: push\n');
    expect(() => loadProjectYaml(p)).toThrow(ProjectYamlError);
  });

  it('defaults zoning when omitted', () => {
    const p = writeYaml(`
meta: { language: zh }
research_questions: [{ id: q1, text: t }]
inclusion_criteria: [a]
exclusion_criteria: [b]
sources: [{ kind: arxiv, queries: [x] }]
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
`);
    const cfg = loadProjectYaml(p);
    expect(cfg.zoning).toEqual({ active_max: 12, buffer_max: 30, min_dwell: 2 });
  });

  it('accepts explicit zoning overrides', () => {
    const p = writeYaml(`
meta: { language: zh }
research_questions: [{ id: q1, text: t }]
inclusion_criteria: [a]
exclusion_criteria: [b]
sources: [{ kind: arxiv, queries: [x] }]
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
zoning: { active_max: 5, buffer_max: 10, min_dwell: 1 }
`);
    expect(loadProjectYaml(p).zoning.active_max).toBe(5);
  });

  it('rejects kind x-inbox', () => {
    const p = writeYaml(`
research_questions: [{ id: RQ1, text: t }]
inclusion_criteria: []
exclusion_criteria: []
sources:
  - kind: x-inbox
    inbox_dir: ~/inbox
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
`);
    expect(() => loadProjectYaml(p)).toThrow(ProjectYamlError);
  });
});
