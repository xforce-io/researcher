import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectYaml, ProjectYamlError } from '../../src/config/project-yaml.js';

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
});
