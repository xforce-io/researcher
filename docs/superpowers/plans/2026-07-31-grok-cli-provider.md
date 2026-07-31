# Grok CLI AgentProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable Grok CLI `AgentRuntime` so Researcher stages can execute `grok -p --model grok-4.5` without traversing Milkie's Coding Plan provider.

**Architecture:** `GlobalConfig` selects `milkie` (compatibility default) or `grok-cli`; a single `createAgentRuntime` factory owns production selection. `GrokCliAdapter` uses argv-based `execa`, maps process outcomes into the existing `InvokeResult`, and leaves library-read's separate `OpenAITextAdapter` untouched.

**Tech Stack:** TypeScript ESM, Zod, execa, Vitest, Node child processes.

## Global Constraints

- `runtime` accepts only `milkie` and `grok-cli`; absent configuration remains `milkie`.
- Grok defaults are executable `grok` and model `grok-4.5`.
- Grok invokes exactly one `grok -p <combined prompt> --model <model> --no-plan --no-memory` process per `invoke`.
- Use an argv array; never shell-interpolate prompts or credentials.
- Success returns stdout, exit code 0, and no modified files.
- Missing executable, timeout, and non-zero exit produce exit code 1, preserve stderr, and use `GROK_CLI_NOT_FOUND`, `GROK_CLI_TIMEOUT`, and `GROK_CLI_EXIT` respectively.
- Existing `MilkieAdapter` remains the default; `OpenAITextAdapter` and library-read are out of scope.

---

### Task 1: Grok CLI adapter and runtime configuration

**Files:**
- Create: `src/adapter/grok-cli.ts`
- Create: `src/adapter/runtime.ts`
- Create: `tests/adapter/grok-cli.test.ts`
- Create: `tests/adapter/runtime.test.ts`
- Modify: `src/config/global-config.ts`
- Modify: `tests/config/global-config.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime`, `InvokeOptions`, `InvokeResult`, `InvokeError` from `src/adapter/interface.ts`.
- Produces: `GrokCliAdapter`, `GrokCliOptions`, and `createAgentRuntime(home?: string): AgentRuntime`.

- [ ] **Step 1: Write failing config and factory tests**

```ts
expect(loadGlobalConfig(path)).toMatchObject({
  runtime: 'milkie',
  runtime_options: { 'grok-cli': { bin: 'grok', model: 'grok-4.5' } },
});
writeFileSync(path, 'runtime: grok-cli\nruntime_options:\n  grok-cli:\n    bin: /tmp/grok\n    model: custom\n');
expect(createAgentRuntime(home).id).toBe('grok-cli');
```

- [ ] **Step 2: Verify the config/factory test fails**

Run: `npx vitest run tests/config/global-config.test.ts tests/adapter/runtime.test.ts`

Expected: FAIL because `grok-cli` is rejected by the current enum and `createAgentRuntime` does not exist.

- [ ] **Step 3: Extend config and implement factory**

```ts
const GrokCliOptionsSchema = z.object({
  bin: z.string().min(1).default('grok'),
  model: z.string().min(1).default('grok-4.5'),
}).default({ bin: 'grok', model: 'grok-4.5' });

export const GlobalConfigSchema = z.object({
  runtime: z.enum(['milkie', 'grok-cli']).default('milkie'),
  runtime_options: z.object({ 'grok-cli': GrokCliOptionsSchema }).default({ 'grok-cli': { bin: 'grok', model: 'grok-4.5' } }),
}).default({ runtime: 'milkie', runtime_options: { 'grok-cli': { bin: 'grok', model: 'grok-4.5' } } });

export function createAgentRuntime(home = resolveResearcherHome()): AgentRuntime {
  const cfg = loadGlobalConfig(join(home, 'config.yaml'));
  return cfg.runtime === 'grok-cli'
    ? new GrokCliAdapter(cfg.runtime_options['grok-cli'])
    : new MilkieAdapter();
}
```

- [ ] **Step 4: Write failing adapter behavior tests**

Use a temporary executable script (written with executable mode) that records argv and optionally writes stdout/stderr/exits. Cover:

```ts
const result = await new GrokCliAdapter({ bin: fake, model: 'grok-4.5' }).invoke({
  cwd: dir, systemPrompt: 'system', userPrompt: 'user', timeoutMs: 500,
});
expect(result).toMatchObject({ output: 'ok', exitCode: 0, modifiedFiles: [] });
expect(readFileSync(argsPath, 'utf8')).toContain('-p');
expect(readFileSync(argsPath, 'utf8')).toContain('--model\ngrok-4.5');
```

Add isolated tests for a missing binary, a script that sleeps beyond `timeoutMs`, and a script exiting 7 with `stderr` text. Expected `error.code` values are `GROK_CLI_NOT_FOUND`, `GROK_CLI_TIMEOUT`, and `GROK_CLI_EXIT`.

- [ ] **Step 5: Verify adapter tests fail**

Run: `npx vitest run tests/adapter/grok-cli.test.ts`

Expected: FAIL because `GrokCliAdapter` is not exported.

- [ ] **Step 6: Implement the minimal CLI adapter**

```ts
export class GrokCliAdapter implements AgentRuntime {
  readonly id = 'grok-cli';
  constructor(private readonly options: GrokCliOptions = { bin: 'grok', model: 'grok-4.5' }) {}

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const prompt = ['# System prompt', opts.systemPrompt, '', '# User prompt', opts.userPrompt, ''].join('\n');
    try {
      const result = await execa(this.options.bin, ['-p', prompt, '--model', this.options.model, '--no-plan', '--no-memory'], {
        cwd: opts.cwd, timeout: opts.timeoutMs ?? 30 * 60 * 1000, reject: false,
      });
      if ((result.exitCode ?? 1) === 0) return { output: result.stdout ?? '', modifiedFiles: [], exitCode: 0, stderr: result.stderr ?? '' };
      return failed('GROK_CLI_EXIT', result.stderr ?? '', result.exitCode ?? 1);
    } catch (error) {
      return mapGrokProcessError(error);
    }
  }
}
```

`mapGrokProcessError` must distinguish `ENOENT` and `timedOut`; all failures have `exitCode: 1`, preserve available stderr, and return a short safe message without an environment dump.

- [ ] **Step 7: Verify Task 1 green and commit**

Run: `npx vitest run tests/config/global-config.test.ts tests/adapter/grok-cli.test.ts tests/adapter/runtime.test.ts`

Expected: PASS.

Commit:

```bash
git add src/config/global-config.ts src/adapter/grok-cli.ts src/adapter/runtime.ts tests/config/global-config.test.ts tests/adapter/grok-cli.test.ts tests/adapter/runtime.test.ts
git commit -m "feat: add Grok CLI agent runtime"
```

### Task 2: Route production agent stages through the factory

**Files:**
- Modify: `src/commands/run.ts`
- Modify: `src/commands/add.ts`
- Modify: `src/commands/read.ts`
- Modify: `src/commands/onboard.ts`
- Modify: `src/web/topic-setup.ts`
- Create: `tests/commands/runtime-selection.test.ts`
- Modify: relevant command/topic-setup tests only if constructor assertions require it

**Interfaces:**
- Consumes: `createAgentRuntime()` from `src/adapter/runtime.ts`.
- Produces: all production agent-stage defaults select the configured provider; optional test injection stays unchanged.

- [ ] **Step 1: Write failing production-selection integration test**

Create a temporary `RESEARCHER_HOME/config.yaml` with `runtime: grok-cli` and a fake `grok` executable. Invoke the production `runRun` path without its `adapter` override, using a stage that returns valid expected content. Assert the fake receives one `-p` call and a success result. Add a failure variant whose fake exits non-zero and assert the stage creates `<stage>.err` containing `GROK_CLI_EXIT`.

- [ ] **Step 2: Verify the selection test fails**

Run: `npx vitest run tests/commands/runtime-selection.test.ts`

Expected: FAIL because production code directly instantiates `MilkieAdapter`, so the fake Grok command is never invoked.

- [ ] **Step 3: Replace direct production defaults**

In each production construction point replace `new MilkieAdapter()` with `createAgentRuntime()`. Preserve explicit injected `adapter` parameters exactly:

```ts
const adapter = opts.adapter ?? createAgentRuntime();
```

For functions without injection, use `const adapter = createAgentRuntime();`. Do not change `src/web/library-read.ts`, which must keep `new OpenAITextAdapter()`.

- [ ] **Step 4: Verify integration tests pass**

Run: `npx vitest run tests/commands/runtime-selection.test.ts tests/commands/run.test.ts tests/commands/add.test.ts tests/commands/read.test.ts tests/commands/onboard.test.ts tests/web/topic-setup.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/commands/run.ts src/commands/add.ts src/commands/read.ts src/commands/onboard.ts src/web/topic-setup.ts tests/commands/runtime-selection.test.ts
git commit -m "feat: select configured agent runtime"
```

### Task 3: Activate Grok for the training project and perform end-to-end verification

**Files:**
- Modify: `/Users/xupeng/.researcher/config.yaml` (local operational config; never commit)
- Modify: `/Users/xupeng/dev/github/research-harness/agentic-model-training/agents/researcher.md`
- Modify: `docs/design/120-grok-cli-provider.md` only to mark `Implemented` after green verification

**Interfaces:**
- Consumes: global runtime config and `GrokCliAdapter` from Tasks 1–2.
- Produces: active training project defaults to the `grok-cli` runtime while its fallback Milkie definition remains valid.

- [ ] **Step 1: Write the explicit local runtime configuration**

```yaml
runtime: grok-cli
runtime_options:
  grok-cli:
    bin: /Users/xupeng/.grok/bin/grok
    model: grok-4.5
```

Restore the active project’s Milkie-only agent definition model to `glm-latest`; the selected Grok model belongs solely to the Grok runtime configuration.

- [ ] **Step 2: Build the merged Researcher source**

Run: `npm run build`

Expected: exit 0 and refreshed `dist/` artifacts.

- [ ] **Step 3: Verify deterministic E2E and real provider**

Run: `npm test`

Expected: all project tests pass, with the pre-existing opt-in Milkie cross-repository test skipped when its environment variable is absent.

Then execute the compiled factory against the actual active project with a connectivity-only prompt:

```bash
RESEARCHER_HOME=/Users/xupeng/.researcher node --input-type=module -e '
  import { createAgentRuntime } from "./dist/adapter/runtime.js";
  const result = await createAgentRuntime().invoke({
    cwd: "/Users/xupeng/dev/github/research-harness/agentic-model-training",
    systemPrompt: "Connectivity probe.",
    userPrompt: "Reply exactly GROK_PROVIDER_OK.",
    timeoutMs: 120000,
  });
  if (result.exitCode !== 0 || result.output.trim() !== "GROK_PROVIDER_OK") process.exit(1);
'
```

Expected: the selected runtime is `grok-cli`, the compiled `GrokCliAdapter` executes the real `grok -p` once, and it returns the exact non-empty probe response. This avoids mutating the research workflow merely to test provider connectivity.

- [ ] **Step 4: Mark design implemented and commit documentation**

Set `docs/design/120-grok-cli-provider.md` status to `Implemented`, then:

```bash
git add docs/design/120-grok-cli-provider.md docs/superpowers/plans/2026-07-31-grok-cli-provider.md
git commit -m "docs: record Grok CLI runtime design"
```
