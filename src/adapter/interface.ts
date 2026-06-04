export interface InvokeOptions {
  /** Working directory for the agent. */
  cwd: string;
  /** Full system prompt (preamble + methodology + project context). */
  systemPrompt: string;
  /** Stage-specific user prompt. */
  userPrompt: string;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
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
}

export interface AgentRuntime {
  readonly id: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
}
