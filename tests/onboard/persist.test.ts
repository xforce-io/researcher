import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { writeOnboardArtifacts, writeRunLog } from '../../src/onboard/persist.js';

describe('writeOnboardArtifacts', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-persist-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: dir });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
    writeFileSync(join(dir, '.researcher/project.yaml'), 'placeholder\n');
    writeFileSync(join(dir, '.researcher/thesis.md'), 'placeholder\n');
    writeFileSync(join(dir, '.researcher/.gitignore'), 'state/runs/\n');
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
    execaSync('git', ['add', '.'], { cwd: dir });
    execaSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  });

  it('writes both files and creates a single commit', async () => {
    await writeOnboardArtifacts({
      repoRoot: dir,
      projectYaml: 'meta:\n  topic_oneline: "x"\n',
      thesisMd: '# Thesis\n',
      slug: 'decision-agent',
    });
    expect(readFileSync(join(dir, '.researcher/project.yaml'), 'utf8')).toContain('topic_oneline');
    expect(readFileSync(join(dir, '.researcher/thesis.md'), 'utf8')).toContain('Thesis');
    const log = execaSync('git', ['log', '--oneline'], { cwd: dir }).stdout;
    expect(log).toContain('researcher: onboard decision-agent');
  });
});

describe('writeRunLog', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-runlog-'));
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
  });

  it('writes answers/prompt/response/result files under state/runs/onboard-<ts>/', () => {
    const runDir = writeRunLog({
      repoRoot: dir,
      answers: [{ questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 't' }],
      prompt: 'P',
      response: 'R',
      result: { status: 'ok' },
    });
    expect(existsSync(runDir)).toBe(true);
    expect(readFileSync(join(runDir, 'prompt.txt'), 'utf8')).toBe('P');
    expect(readFileSync(join(runDir, 'response.txt'), 'utf8')).toBe('R');
    expect(JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'))).toEqual({ status: 'ok' });
    expect(JSON.parse(readFileSync(join(runDir, 'answers.json'), 'utf8'))).toHaveLength(1);
    const entries = readdirSync(join(dir, '.researcher/state/runs'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^onboard-/);
  });
});
