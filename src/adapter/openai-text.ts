import OpenAI from 'openai';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const DEFAULT_MODEL = 'glm-latest';

export class OpenAITextAdapter implements AgentRuntime {
  readonly id = 'openai-compatible-text';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.client = new OpenAI({
      apiKey: env.VOLCENGINE_TOKEN ?? env.OPENAI_API_KEY ?? '',
      baseURL: env.VOLCENGINE_API_BASE ?? env.OPENAI_API_BASE_URL,
    });
    this.model = env.RESEARCHER_LIBRARY_READ_MODEL ?? env.VOLCENGINE_MODEL ?? DEFAULT_MODEL;
  }

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    try {
      const raw = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        max_tokens: opts.maxTokens,
        thinking: { type: 'disabled' },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        thinking: { type: 'disabled' };
      });
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
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
