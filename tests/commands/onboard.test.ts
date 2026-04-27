import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runOnboard } from '../../src/commands/onboard.js';
import { resolvePackageRoot } from '../../src/paths.js';

// Stub the adapter so the test does not call real `claude`.
vi.mock('../../src/adapter/claude-code.js', () => ({
  ClaudeCodeAdapter: class {
    id = 'fake';
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
    process.env.RESEARCHER_CLAUDE_BIN = 'true';
    mkdirSync(join(methHome, 'methodology'));
    const pkg = resolvePackageRoot();
    writeFileSync(
      join(methHome, 'methodology', 'onboarding.md'),
      readFileSync(join(pkg, 'methodology', 'onboarding.md'))
    );
  });

  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
    delete process.env.RESEARCHER_CLAUDE_BIN;
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
});
