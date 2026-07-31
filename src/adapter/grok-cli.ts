import { execa } from 'execa';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface GrokCliOptions {
  bin: string;
  model: string;
}

export class GrokCliAdapter implements AgentRuntime {
  readonly id = 'grok-cli';

  constructor(
    private readonly options: GrokCliOptions = { bin: 'grok', model: 'grok-4.5' },
  ) {}

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const prompt = [
      '# System prompt',
      stripNul(opts.systemPrompt),
      '',
      '# User prompt',
      stripNul(opts.userPrompt),
      '',
    ].join('\n');

    try {
      const result = await execa(
        this.options.bin,
        ['-p', prompt, '--model', this.options.model, '--no-plan', '--no-memory'],
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          reject: false,
        },
      );
      if ('code' in result && result.code === 'ENOENT') return mapGrokProcessError(result);
      if (result.timedOut) return failed('GROK_CLI_TIMEOUT', 'Grok CLI timed out.', result.stderr ?? '');
      if (result.exitCode === 0) {
        return {
          output: result.stdout ?? '',
          modifiedFiles: [],
          exitCode: 0,
          stderr: result.stderr ?? '',
        };
      }
      return failed(
        'GROK_CLI_EXIT',
        `Grok CLI exited with code ${result.exitCode ?? 1}.`,
        result.stderr ?? '',
      );
    } catch (error) {
      return mapGrokProcessError(error);
    }
  }
}

function mapGrokProcessError(error: unknown): InvokeResult {
  const processError = error as { code?: unknown; stderr?: unknown; timedOut?: unknown };
  const stderr = typeof processError.stderr === 'string' ? processError.stderr : '';

  if (processError.code === 'ENOENT') {
    return failed('GROK_CLI_NOT_FOUND', 'Grok CLI executable was not found.', stderr);
  }
  if (processError.timedOut === true) {
    return failed('GROK_CLI_TIMEOUT', 'Grok CLI timed out.', stderr);
  }
  return failed('GROK_CLI_EXIT', 'Grok CLI could not be started.', stderr);
}

function failed(code: string, message: string, stderr: string): InvokeResult {
  return {
    output: message,
    modifiedFiles: [],
    exitCode: 1,
    stderr,
    error: { code, message },
  };
}

function stripNul(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: matches NUL
  return s.replace(/\u0000/g, '');
}
