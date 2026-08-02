import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import {
  applyTopicSetup,
  buildSetupAnswers,
  generateTopicSetup,
} from '../../src/web/topic-setup.js';
import { isThesisBodyHollow } from '../../src/onboard/thesis-hollow.js';
import { scaffoldTopicRepo } from '../../src/commands/init.js';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../../src/paths.js';
import type { AgentRuntime } from '../../src/adapter/interface.js';
import { isThesisTemplate } from '../../src/onboard/all-templates-check.js';

function mockRuntime(output: string): AgentRuntime {
  return {
    id: 'mock',
    async invoke() {
      return { output, modifiedFiles: [], exitCode: 0 };
    },
  };
}

const DRAFT_YAML = `meta:
  topic_oneline: "Decision policies for agents"
  language: zh
research_questions:
  - id: RQ1
    text: "How do agents choose to ask vs act?"
inclusion_criteria:
  - "Addresses decision policies"
exclusion_criteria: []
sources:
  - kind: arxiv
    queries:
      - "agent decision policy"
cadence:
  default_interval_days: 7
  backoff_after_empty_runs: 3
`;

const DRAFT_THESIS = `# Working Thesis

## Working thesis

Agents should escalate when uncertainty exceeds a threshold.
Falsifier: always-acting agents match escalate policies on calibrated regret.

## Taste

- Prefer mechanism papers over leaderboard-only reports.

## Anti-patterns

- Benchmark-only papers without a method.

## Examples

(empty until first notes)
`;

function agentOutput(yaml: string, thesis: string): string {
  return [
    '<<<PROJECT_YAML>>>',
    yaml,
    '<<<END_PROJECT_YAML>>>',
    '',
    '<<<THESIS_MD>>>',
    thesis,
    '<<<END_THESIS_MD>>>',
  ].join('\n');
}

function setupTopicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'r-topic-setup-'));
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  scaffoldTopicRepo({ repoRoot: dir });
  const py = join(resolveProjectResearcherDir(dir), 'project.yaml');
  writeFileSync(
    py,
    readFileSync(py, 'utf8').replace(
      /^([ \t]*topic_oneline:[ \t]*).*$/m,
      '$1"Decision policies for agents"',
    ),
  );
  execaSync('git', ['add', '.'], { cwd: dir });
  execaSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'scaffold'],
    { cwd: dir },
  );
  return dir;
}

describe('buildSetupAnswers', () => {
  const questions = [
    { id: 'Q1', fieldId: 'topic_oneline' },
    { id: 'Q2', fieldId: 'research_questions' },
    { id: 'Q6', fieldId: 'seed_keywords' },
    { id: 'Q7', fieldId: 'working_hypotheses' },
    { id: 'Q8', fieldId: 'design_anchor' },
  ];

  it('requires oneline and auto-seeds RQ + keywords + hypotheses when optionals empty', () => {
    const answers = buildSetupAnswers({ oneline: '  Hello topic  ' }, questions);
    expect(answers.find((a) => a.questionId === 'Q1')).toEqual({
      questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'Hello topic',
    });
    // Web setup auto-fills Q2/Q6/Q7 from oneline so the agent is not skip-only.
    expect(answers.find((a) => a.questionId === 'Q2')?.kind).toBe('text');
    expect(answers.find((a) => a.questionId === 'Q2')?.text).toMatch(/Hello topic/);
    expect(answers.find((a) => a.questionId === 'Q6')?.kind).toBe('text');
    expect(answers.find((a) => a.questionId === 'Q7')?.kind).toBe('text');
    expect(answers.find((a) => a.questionId === 'Q7')?.text).toMatch(/Hello topic/);
    expect(answers.find((a) => a.questionId === 'Q7')?.text).toMatch(/Falsifier/i);
    expect(answers.find((a) => a.questionId === 'Q8')?.kind).toBe('skipped');
  });

  it('maps stake and seeds', () => {
    const answers = buildSetupAnswers(
      { oneline: 'x', stake: 'build triage', seeds: 'agent policy' },
      questions,
    );
    expect(answers.find((a) => a.questionId === 'Q8')).toMatchObject({
      kind: 'text', text: 'build triage',
    });
    expect(answers.find((a) => a.questionId === 'Q6')).toMatchObject({
      kind: 'text', text: 'agent policy',
    });
  });
});

describe('generateTopicSetup + applyTopicSetup', () => {
  beforeEach(() => {
    // methodology must exist for generate
    const home = process.env.RESEARCHER_HOME;
    void home;
  });

  it('generates a draft via mock runtime and applies it', async () => {
    const topicDir = setupTopicDir();
    // Point methodology install at package methodology if missing
    const methHome = mkdtempSync(join(tmpdir(), 'r-home-setup-'));
    mkdirSync(join(methHome, 'methodology'), { recursive: true });
    writeFileSync(
      join(methHome, 'methodology/onboarding.md'),
      readFileSync(join(resolvePackageRoot(), 'methodology/onboarding.md')),
    );
    const prev = process.env.RESEARCHER_HOME;
    process.env.RESEARCHER_HOME = methHome;

    try {
      expect(isThesisTemplate(topicDir)).toBe(true);
      const draft = await generateTopicSetup({
        topicDir,
        form: { oneline: 'Decision policies for agents', seeds: 'agent decision' },
        runtime: mockRuntime(agentOutput(DRAFT_YAML, DRAFT_THESIS)),
      });
      expect(draft.projectYaml).toContain('Decision policies');
      expect(draft.thesisMd).toContain('Working thesis');

      await applyTopicSetup({
        topicDir,
        projectYaml: draft.projectYaml,
        thesisMd: draft.thesisMd,
        oneline: 'Decision policies for agents',
      });

      expect(isThesisTemplate(topicDir)).toBe(false);
      expect(readFileSync(join(resolveProjectResearcherDir(topicDir), 'thesis.md'), 'utf8'))
        .toContain('Working thesis');
      expect(existsSync(join(topicDir, 'notes/00_research_landscape.md'))).toBe(true);

      await expect(
        generateTopicSetup({
          topicDir,
          form: { oneline: 'x' },
          runtime: mockRuntime(agentOutput(DRAFT_YAML, DRAFT_THESIS)),
        }),
      ).rejects.toThrow(/already set up|non-template/i);
    } finally {
      if (prev === undefined) delete process.env.RESEARCHER_HOME;
      else process.env.RESEARCHER_HOME = prev;
    }
  });

  it('apply clears open_questions even when soul files are already identical to HEAD', async () => {
    const topicDir = setupTopicDir();
    const dot = resolveProjectResearcherDir(topicDir);
    // Pretend a prior thin-signal left open_questions, and draft equals current files.
    writeFileSync(join(dot, 'open_questions.md'), '# Open Questions\n\n1. What?\n');
    writeFileSync(join(topicDir, '.milkie/state.sqlite'), 'noise');
    // Real (non-hollow) soul already on disk — apply is a content no-op but must clear OQ.
    writeFileSync(join(dot, 'project.yaml'), DRAFT_YAML);
    writeFileSync(join(dot, 'thesis.md'), DRAFT_THESIS);
    execaSync('git', ['add', '.'], { cwd: topicDir });
    execaSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'pre-filled soul'],
      { cwd: topicDir },
    );

    await applyTopicSetup({
      topicDir,
      projectYaml: DRAFT_YAML,
      thesisMd: DRAFT_THESIS,
      oneline: 'Decision policies for agents',
    });

    expect(existsSync(join(dot, 'open_questions.md'))).toBe(false);
    expect(isThesisBodyHollow(readFileSync(join(dot, 'thesis.md'), 'utf8'))).toBe(false);
  });

  it('rejects hollow template-echo thesis on apply', async () => {
    const topicDir = setupTopicDir();
    const hollowThesis = readFileSync(
      join(resolveProjectResearcherDir(topicDir), 'thesis.md'),
      'utf8',
    );
    expect(isThesisBodyHollow(hollowThesis)).toBe(true);

    await expect(
      applyTopicSetup({
        topicDir,
        projectYaml: DRAFT_YAML,
        thesisMd: hollowThesis,
        oneline: 'Decision policies for agents',
      }),
    ).rejects.toThrow(/template\/hollow/i);
  });

  it('rejects hollow thesis from generate (model template echo)', async () => {
    const topicDir = setupTopicDir();
    const methHome = mkdtempSync(join(tmpdir(), 'r-home-setup-hollow-'));
    mkdirSync(join(methHome, 'methodology'), { recursive: true });
    writeFileSync(
      join(methHome, 'methodology/onboarding.md'),
      readFileSync(join(resolvePackageRoot(), 'methodology/onboarding.md')),
    );
    const prev = process.env.RESEARCHER_HOME;
    process.env.RESEARCHER_HOME = methHome;
    const hollowThesis = readFileSync(
      join(resolveProjectResearcherDir(topicDir), 'thesis.md'),
      'utf8',
    );

    try {
      await expect(
        generateTopicSetup({
          topicDir,
          form: { oneline: 'Decision policies for agents', seeds: 'agent decision' },
          runtime: mockRuntime(agentOutput(DRAFT_YAML, hollowThesis)),
        }),
      ).rejects.toThrow(/template\/hollow/i);
    } finally {
      if (prev === undefined) delete process.env.RESEARCHER_HOME;
      else process.env.RESEARCHER_HOME = prev;
    }
  });

});
