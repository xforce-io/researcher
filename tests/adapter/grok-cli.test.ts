import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrokCliAdapter } from '../../src/adapter/grok-cli.js';

function writeExecutable(dir: string, body: string): string {
  const bin = join(dir, 'fake-grok');
  writeFileSync(bin, `#!/usr/bin/env node\n${body}`);
  chmodSync(bin, 0o755);
  return bin;
}

function invoke(bin: string, cwd: string, timeoutMs = 500) {
  return new GrokCliAdapter({ bin, model: 'grok-4.5' }).invoke({
    cwd,
    systemPrompt: 'system',
    userPrompt: 'user',
    timeoutMs,
  });
}

describe('GrokCliAdapter', () => {
  it('invokes Grok with a single combined prompt and fixed single-turn flags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'researcher-grok-cli-'));
    const argsPath = join(dir, 'argv.txt');
    const bin = writeExecutable(
      dir,
      `require('node:fs').writeFileSync(${JSON.stringify(argsPath)}, process.argv.slice(2).join('\\n')); process.stdout.write('ok');`,
    );

    const result = await invoke(bin, dir);

    expect(result).toMatchObject({ output: 'ok', exitCode: 0, modifiedFiles: [], stderr: '' });
    expect(readFileSync(argsPath, 'utf8')).toBe([
      '-p',
      '# System prompt',
      'system',
      '',
      '# User prompt',
      'user',
      '',
      '--model',
      'grok-4.5',
      '--no-plan',
      '--no-memory',
    ].join('\n'));
  });

  it('reports a missing executable with the Grok not-found error code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'researcher-grok-cli-'));

    const result = await invoke(join(dir, 'missing-grok'), dir);

    expect(result).toMatchObject({
      exitCode: 1,
      modifiedFiles: [],
      error: { code: 'GROK_CLI_NOT_FOUND' },
    });
  });

  it('reports a timed-out executable with the Grok timeout error code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'researcher-grok-cli-'));
    // This subprocess integration test must outlive execa's real timeout.
    const bin = writeExecutable(dir, 'setTimeout(() => {}, 10_000);');

    const result = await invoke(bin, dir, 100);

    expect(result).toMatchObject({
      exitCode: 1,
      modifiedFiles: [],
      error: { code: 'GROK_CLI_TIMEOUT' },
    });
  });

  it('reports a non-zero Grok exit with stderr diagnostics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'researcher-grok-cli-'));
    const bin = writeExecutable(dir, "process.stderr.write('Grok rejected request'); process.exit(7);");

    const result = await invoke(bin, dir);

    expect(result).toMatchObject({
      exitCode: 1,
      modifiedFiles: [],
      stderr: 'Grok rejected request',
      error: { code: 'GROK_CLI_EXIT' },
    });
  });
});
