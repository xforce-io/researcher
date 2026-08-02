import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';

function writeExecutable(dir: string, name: string, body: string): string {
  const bin = join(dir, name);
  writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function configureGrokRuntime(home: string, bin: string): void {
  writeFileSync(
    join(home, 'config.yaml'),
    `runtime: grok-cli\nruntime_options:\n  grok-cli:\n    bin: ${bin}\n    model: test-model\n`,
  );
}

describe('production runtime selection', () => {
  let home: string;
  let project: string;
  let originalHome: string | undefined;
  let originalMilkieBin: string | undefined;
  beforeEach(async () => {
    originalHome = process.env.RESEARCHER_HOME;
    originalMilkieBin = process.env.RESEARCHER_MILKIE_BIN;
    home = mkdtempSync(join(tmpdir(), 'researcher-runtime-home-'));
    project = mkdtempSync(join(tmpdir(), 'researcher-runtime-project-'));
    process.env.RESEARCHER_HOME = home;
    process.env.RESEARCHER_MILKIE_BIN = writeExecutable(
      home,
      'fake-milkie',
      "console.log('{\"status\":\"ok\",\"lastOutput\":\"SOUL_DECISION: skip\"}');",
    );
    execaSync('git', ['init', '-b', 'main'], { cwd: project });
    execaSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
    execaSync('git', ['config', 'user.name', 'Test User'], { cwd: project });
    await runInit({ targetDir: project });
    await runMethodologyInstall();
    execaSync('git', ['add', '.researcher', '.milkie', 'agents', '.gitignore'], { cwd: project });
    execaSync('git', ['commit', '-m', 'initialize researcher'], { cwd: project });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.RESEARCHER_HOME;
    else process.env.RESEARCHER_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
    if (originalMilkieBin === undefined) delete process.env.RESEARCHER_MILKIE_BIN;
    else process.env.RESEARCHER_MILKIE_BIN = originalMilkieBin;
    vi.resetModules();
    rmSync(project, { recursive: true, force: true });
  });

  it('runs the configured Grok CLI runtime for a production run', async () => {
    const argsPath = join(home, 'grok-args.json');
    const bin = writeExecutable(
      home,
      'fake-grok-success',
      `require('node:fs').writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2))); process.stdout.write('SOUL_DECISION: skip\\n');`,
    );
    configureGrokRuntime(home, bin);

    // Import after setting the fallback binary so this test can prove it is unused.
    const { runRun } = await import('../../src/commands/run.js');
    // discover on so we reach soul (empty linked queue would otherwise exit first).
    await expect(runRun({ cwd: project, discover: true })).resolves.toMatchObject({ outcome: 'no-queries' });

    const args = JSON.parse(readFileSync(argsPath, 'utf8')) as string[];
    expect(args.filter((arg) => arg === '-p')).toHaveLength(1);
  });

  it('records Grok CLI failures in the failed production stage artifact', async () => {
    const bin = writeExecutable(
      home,
      'fake-grok-failure',
      "process.stderr.write('simulated Grok failure'); process.exit(7);",
    );
    configureGrokRuntime(home, bin);

    // Import after setting the fallback binary so this test can prove it is unused.
    const { runRun } = await import('../../src/commands/run.js');
    await expect(runRun({ cwd: project, discover: true })).rejects.toThrow(/soul stage agent exited 1/);

    const runsDir = join(project, '.researcher', 'state', 'runs');
    const runDir = readdirSync(runsDir).find((entry) => entry.startsWith('r-'));
    expect(runDir).toBeDefined();
    expect(readFileSync(join(runsDir, runDir!, 'soul.err'), 'utf8')).toContain('GROK_CLI_EXIT');
  });
});
