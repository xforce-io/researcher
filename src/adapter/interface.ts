export interface InvokeOptions {
  /** Working directory for the agent. */
  cwd: string;
  /** Full system prompt (preamble + methodology + project context). */
  systemPrompt: string;
  /** Stage-specific user prompt. */
  userPrompt: string;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
  /** Desired maximum model output tokens. Adapters that cannot enforce it may ignore it. */
  maxTokens?: number;
}

export interface InvokeError {
  /** Provider-specific error code, when safely supplied by the runtime. */
  code?: string;
  /** Human-readable failure summary. */
  message: string;
  /** Opaque provider diagnostics, when available. */
  details?: unknown;
}

export interface InvokeResult {
  /** Final stdout content from the agent (its textual output). */
  output: string;
  /** Files the agent reported as modified, if extractable. */
  modifiedFiles: string[];
  /** Exit code of the underlying process. */
  exitCode: number;
  /** stderr of the underlying process ('' on success). Persisted on failure for diagnosis. */
  stderr?: string;
  /** Provider finish reason, when the adapter can recover it from the runtime trace. */
  finishReason?: string;
  /** Structured adapter error, when safely extractable from the provider. */
  error?: InvokeError;
}

export interface AgentRuntime {
  readonly id: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
}
