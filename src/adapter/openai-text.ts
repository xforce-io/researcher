import OpenAI from 'openai';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const DEFAULT_MODEL = 'glm-latest';
/** No silent multi-retry stacking: library-read must fail fast and surface the error. */
const CLIENT_MAX_RETRIES = 0;

export class OpenAITextAdapter implements AgentRuntime {
  readonly id = 'openai-compatible-text';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.client = new OpenAI({
      apiKey: env.VOLCENGINE_TOKEN ?? env.OPENAI_API_KEY ?? '',
      baseURL: env.VOLCENGINE_API_BASE ?? env.OPENAI_API_BASE_URL,
      maxRetries: CLIENT_MAX_RETRIES,
    });
    this.model = env.RESEARCHER_LIBRARY_READ_MODEL ?? env.VOLCENGINE_MODEL ?? DEFAULT_MODEL;
  }

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    try {
      const requestOptions =
        opts.timeoutMs !== undefined
          ? { timeout: opts.timeoutMs, maxRetries: CLIENT_MAX_RETRIES }
          : { maxRetries: CLIENT_MAX_RETRIES };
      const raw = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: opts.userPrompt },
          ],
          max_tokens: opts.maxTokens,
          thinking: { type: 'disabled' },
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
          thinking: { type: 'disabled' };
        },
        requestOptions,
      );
      const choice = raw.choices[0];
      return {
        output: choice?.message?.content ?? '',
        modifiedFiles: [],
        exitCode: 0,
        finishReason: choice?.finish_reason ?? undefined,
      };
    } catch (err) {
      return {
        output: '',
        modifiedFiles: [],
        exitCode: 1,
        stderr: formatAdapterError(err),
      };
    }
  }
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
