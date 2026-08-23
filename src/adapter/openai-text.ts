import OpenAI from 'openai';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const DEFAULT_MODEL = 'glm-latest';
/** No silent multi-retry stacking: library-read must fail fast and surface the error. */
const CLIENT_MAX_RETRIES = 0;

type ThinkingSend = 'disabled' | 'omit';
type CompletionCreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
  thinking?: { type: 'disabled' };
};

/** Process-lifetime: endpoint+model pairs that rejected thinking.disabled. */
const omittedThinking = new Set<string>();

export function resetThinkingSupportCache(): void {
  omittedThinking.clear();
}

export class OpenAITextAdapter implements AgentRuntime {
  readonly id = 'openai-compatible-text';
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly thinkingKey: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.client = new OpenAI({
      apiKey: env.VOLCENGINE_TOKEN ?? env.OPENAI_API_KEY ?? '',
      baseURL: env.VOLCENGINE_API_BASE ?? env.OPENAI_API_BASE_URL,
      maxRetries: CLIENT_MAX_RETRIES,
    });
    this.model = env.RESEARCHER_LIBRARY_READ_MODEL ?? env.VOLCENGINE_MODEL ?? DEFAULT_MODEL;
    const endpoint = env.VOLCENGINE_API_BASE ?? env.OPENAI_API_BASE_URL ?? '';
    this.thinkingKey = `${endpoint}\t${this.model}`;
  }

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const requestOptions =
      opts.timeoutMs !== undefined
        ? { timeout: opts.timeoutMs, maxRetries: CLIENT_MAX_RETRIES }
        : { maxRetries: CLIENT_MAX_RETRIES };
    try {
      return await this.createCompletion(opts, requestOptions);
    } catch (err) {
      if (this.thinkingSend === 'disabled' && isThinkingUnsupportedError(err)) {
        omittedThinking.add(this.thinkingKey);
        try {
          return await this.createCompletion(opts, requestOptions);
        } catch (retryErr) {
          return failedInvoke(retryErr);
        }
      }
      return failedInvoke(err);
    }
  }

  private get thinkingSend(): ThinkingSend {
    return omittedThinking.has(this.thinkingKey) ? 'omit' : 'disabled';
  }

  private async createCompletion(
    opts: InvokeOptions,
    requestOptions: { timeout?: number; maxRetries: number },
  ): Promise<InvokeResult> {
    const raw = await this.client.chat.completions.create(
      completionParams(this.model, opts, this.thinkingSend),
      requestOptions,
    );
    const choice = raw.choices[0];
    return {
      output: choice?.message?.content ?? '',
      modifiedFiles: [],
      exitCode: 0,
      finishReason: choice?.finish_reason ?? undefined,
    };
  }
}

function completionParams(
  model: string,
  opts: InvokeOptions,
  thinkingSend: ThinkingSend,
): CompletionCreateParams {
  const params: CompletionCreateParams = {
    model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    max_tokens: opts.maxTokens,
  };
  if (thinkingSend === 'disabled') {
    params.thinking = { type: 'disabled' };
  }
  return params;
}

function isThinkingUnsupportedError(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== undefined && status !== 400) return false;
  const text = err instanceof Error ? err.message : String(err);
  return /thinking/i.test(text) && /not supported|unsupported/i.test(text);
}

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object' || !('status' in err)) return undefined;
  return typeof err.status === 'number' ? err.status : undefined;
}

function failedInvoke(err: unknown): InvokeResult {
  return {
    output: '',
    modifiedFiles: [],
    exitCode: 1,
    stderr: formatAdapterError(err),
  };
}

function formatAdapterError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const name = err.name || 'Error';
  // OpenAI SDK aborts/timeouts surface as APIConnectionTimeoutError / AbortError etc.
  if (/abort|timeout/i.test(name) || /abort|timeout/i.test(err.message)) {
    return `${name}: ${err.message}`;
  }
  return err.message;
}
