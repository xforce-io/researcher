import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runOnboard } from '../../src/commands/onboard.js';
import { scaffoldTopicRepo } from '../../src/commands/init.js';
import { resolvePackageRoot } from '../../src/paths.js';
const state = vi.hoisted(() => ({
  grokInvocations: 0,
}));

const rewrittenArtifacts = [
  '<<<PROJECT_YAML>>>',
  'meta:',
  '  topic_oneline: "Decision policies."',
  'research_questions:',
  '  - id: RQ1',
  '    text: "How do agents decide?"',
  '<<<END_PROJECT_YAML>>>',
  '',
  '<<<THESIS_MD>>>',
  '# Thesis',
  '## Working thesis',
  'Test thesis.',
  '<<<END_THESIS_MD>>>',
].join('\n');

vi.mock('../../src/adapter/grok-cli.js', () => ({
  GrokCliAdapter: class {
    id = 'grok-cli';
    async invoke() {
      state.grokInvocations += 1;
      return { exitCode: 0, modifiedFiles: [], output: rewrittenArtifacts };
    }
  },
}));


// Stub the adapter so the test does not call real `milkie`.
vi.mock('../../src/adapter/milkie.js', () => ({
  MilkieAdapter: class {
    id = 'milkie';
    async invoke() {
      return {
        exitCode: 0,
        modifiedFiles: [],
        output: [
          '<<<PROJECT_YAML>>>',
          'meta:',
          '  topic_oneline: "Decision policies."',
          'research_questions:',
          '  - id: RQ1',
          '    text: "How do agents decide?"',
          '<<<END_PROJECT_YAML>>>',
          '',
          '<<<THESIS_MD>>>',
          '# Thesis',
          '## Working thesis',
          'Test thesis.',
          '<<<END_THESIS_MD>>>',
        ].join('\n'),
      };
    }
  },
}));

describe('runOnboard (integration)', () => {
  let dir: string;
  let methHome: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-onboard-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: dir });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
    methHome = mkdtempSync(join(tmpdir(), 'r-meth-'));
    process.env.RESEARCHER_HOME = methHome;
    process.env.RESEARCHER_MILKIE_BIN = 'true';
    mkdirSync(join(methHome, 'methodology'));
    const pkg = resolvePackageRoot();
    writeFileSync(
      join(methHome, 'methodology', 'onboarding.md'),
      readFileSync(join(pkg, 'methodology', 'onboarding.md'))
    );
    state.grokInvocations = 0;
  });
  it('retains the Milkie preflight for the default runtime', async () => {
    process.env.RESEARCHER_MILKIE_BIN = '__researcher_missing_milkie__';

    await expect(runOnboard({ cwd: dir })).rejects.toThrow(
      'milkie CLI not found; install it or set RESEARCHER_MILKIE_BIN'
    );
  });

  it('invokes the configured Grok runtime without a Milkie binary', async () => {
    process.env.RESEARCHER_MILKIE_BIN = '__researcher_missing_milkie__';
    writeFileSync(join(methHome, 'config.yaml'), 'runtime: grok-cli\n');

    await runOnboard({
      cwd: dir,
      answersOverride: [
        { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'Grok-only topic' },
        { questionId: 'Q2', fieldId: 'research_questions', kind: 'text', text: 'How do Grok agents decide?' },
        { questionId: 'Q3', fieldId: 'inclusion_criteria', kind: 'skipped' },
        { questionId: 'Q4', fieldId: 'exclusion_criteria', kind: 'skipped' },
        { questionId: 'Q5', fieldId: 'taste', kind: 'skipped' },
        { questionId: 'Q6', fieldId: 'seed_keywords', kind: 'skipped' },
      ],
    });

    expect(state.grokInvocations).toBe(1);
  });

  it('rejects a missing methodology before scaffolding for the configured Grok runtime', async () => {
    process.env.RESEARCHER_MILKIE_BIN = '__researcher_missing_milkie__';
    writeFileSync(join(methHome, 'config.yaml'), 'runtime: grok-cli\n');
    rmSync(join(methHome, 'methodology', 'onboarding.md'));

    let error: unknown;
    try {
      await runOnboard({ cwd: dir });
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('onboarding methodology missing at'),
      })
    );
    expect(existsSync(join(dir, '.researcher'))).toBe(false);
    expect(state.grokInvocations).toBe(0);
  });


  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
    delete process.env.RESEARCHER_MILKIE_BIN;
  });

  it('produces a topic repo with project.yaml + thesis.md committed (TUI auto-driver)', async () => {
    await runOnboard({
      cwd: dir,
      // Test-only injection: feed pre-baked answers, skip TUI rendering
      answersOverride: [
        { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'decision agent topic' },
        { questionId: 'Q2', fieldId: 'research_questions', kind: 'text', text: 'How do agents decide?' },
        { questionId: 'Q3', fieldId: 'inclusion_criteria', kind: 'skipped' },
        { questionId: 'Q4', fieldId: 'exclusion_criteria', kind: 'skipped' },
        { questionId: 'Q5', fieldId: 'taste', kind: 'skipped' },
        { questionId: 'Q6', fieldId: 'seed_keywords', kind: 'skipped' },
      ],
      autoAcceptDiff: true,
    });

    expect(existsSync(join(dir, '.researcher/project.yaml'))).toBe(true);
    expect(readFileSync(join(dir, '.researcher/project.yaml'), 'utf8')).toContain('Decision policies');
    expect(readFileSync(join(dir, '.researcher/thesis.md'), 'utf8')).toContain('Working thesis');
    const log = execaSync('git', ['log', '--oneline'], { cwd: dir }).stdout;
    expect(log).toMatch(/researcher: onboard /);
  });

  it('migrates a pristine legacy runtime before onboarding commits it', async () => {
    scaffoldTopicRepo({ repoRoot: dir });
    writeFileSync(join(dir, '.milkie/agents.json'), JSON.stringify({
      agents: [
        { id: 'researcher', file: '../agents/researcher.md' },
        { id: 'custom', file: '../agents/custom.md' },
      ],
    }) + '\n');
    writeFileSync(join(dir, 'agents/researcher.md'), 'custom agent contract\n');
    execaSync('git', ['add', 'agents/researcher.md'], { cwd: dir });
    execaSync('git', ['commit', '-m', 'legacy agent customization'], { cwd: dir });
    rmSync(join(dir, 'agents/researcher-collect.md'));
    rmSync(join(dir, 'agents/researcher-triage.md'));

    await runOnboard({
      cwd: dir,
      answersOverride: [
        { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'legacy decision agents' },
        { questionId: 'Q2', fieldId: 'research_questions', kind: 'text', text: 'How do legacy agents decide?' },
        { questionId: 'Q3', fieldId: 'inclusion_criteria', kind: 'skipped' },
        { questionId: 'Q4', fieldId: 'exclusion_criteria', kind: 'skipped' },
        { questionId: 'Q5', fieldId: 'taste', kind: 'skipped' },
        { questionId: 'Q6', fieldId: 'seed_keywords', kind: 'skipped' },
      ],
      autoAcceptDiff: true,
    });

    const registry = JSON.parse(readFileSync(join(dir, '.milkie/agents.json'), 'utf8'));
    expect(registry.agents.map((agent: { id: string }) => agent.id)).toEqual([
      'researcher',
      'custom',
      'researcher-collect',
      'researcher-triage',
    ]);
    expect(readFileSync(join(dir, 'agents/researcher.md'), 'utf8')).toBe('custom agent contract\n');
    expect(existsSync(join(dir, 'agents/researcher-collect.md'))).toBe(true);
    expect(existsSync(join(dir, 'agents/researcher-triage.md'))).toBe(true);
    const committed = execaSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir }).stdout;
    expect(committed).toContain('.milkie/agents.json');
    expect(committed).toContain('agents/researcher.md');
    expect(committed).toContain('agents/researcher-collect.md');
    expect(committed).toContain('agents/researcher-triage.md');
  });
});
