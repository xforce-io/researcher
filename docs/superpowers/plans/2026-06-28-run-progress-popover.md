# Run 按钮实时阶段进度 + 可收起详情弹层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web console 的 Run 按钮在运行时显示实时阶段进度（如 `⟳ discover (3/6)`），点击展开一个可收起的锚定弹层（阶段清单 + 实时日志），运行中刷新页面能无缝重连。

**Architecture:** 阶段事件通过 Node 父子进程内建 IPC（`process.send` / `child.on('message')`）从 run 子进程传到 serve 进程——独立于 stdout（stdout 仍是人类日志，喂 live log），零碰撞、无 env var、无模式判断。`run.ts` 组装“计划”（有序阶段名）作为 `plan` 事件、`runStages` 每阶段发 `stage` 事件，二者经 SSE 转发给前端；前端不解析任何文本，直接渲染 typed 事件。刷新重连靠 SSR 把当前 active run 的 `{taskId, startedAt}` 嵌入页面 + `subscribe()` 回放。

**Tech Stack:** TypeScript (ESM, `"type":"module"`)、Node `child_process.fork` IPC、原生 `http` + SSE、vitest、内联 SSR 字符串视图。

## Global Constraints

- 语言/ESM：所有 import 用 `.js` 扩展（项目是 ESM）。
- 不新增依赖。`defaultRunner` 从 execa 改为 Node 内建 `child_process.fork`。
- 不开新 HTTP 端点；active run 信息走 SSR 内嵌。
- 后端权威 index/total：前端只渲染 `plan`/`stage` 事件，不解析日志文本、不维护阶段目录、不猜模式。
- 状态存于 serve 进程内存：撑过浏览器刷新，不撑 serve 进程重启（单进程本地 serve 的合理定位，范围外）。
- `process.send?.(...)` 的可选链是唯一的“有无父进程在听”判断——CLI 直跑时 `process.send` 为 `undefined`，自动 no-op。
- 阶段名取值（`Stage` 联合，定义于 `src/state/runs.ts`）：`bootstrap | soul | discover | read | synthesize | package | feed-synthesize | feed-enrich`。

---

### Task 1: 流水线发出结构化 run 事件（plan + stage）

**Files:**
- Create: `src/pipeline/events.ts`
- Modify: `src/pipeline/runner.ts:9-15`（`runStages`）
- Modify: `src/commands/run.ts`（feed 分支约 `:97-107`、arxiv 分支约 `:115-129`）
- Test: `tests/pipeline/runner.test.ts`、`tests/commands/run.test.ts:124-146`

**Interfaces:**
- Produces:
  - `type RunEvent = { type: 'plan'; stages: Stage[] } | { type: 'stage'; name: Stage }`（`src/pipeline/events.ts`）
  - `function emitEvent(ev: RunEvent): void`（`src/pipeline/events.ts`）—— `process.send?.(ev)`
- Consumes: `Stage`（`src/state/runs.ts`）

- [ ] **Step 1: 写失败测试 —— runStages 每阶段发 stage 事件**

在 `tests/pipeline/runner.test.ts` 的 `describe('runStages', ...)` 内追加：

```ts
  it('emits a {type:"stage"} event for each stage via process.send', async () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runner-'));
    const rd = new RunDir(base, newRunId());
    const sent: unknown[] = [];
    const orig = process.send;
    (process as { send?: unknown }).send = (m: unknown) => { sent.push(m); return true; };
    try {
      await runStages(rd, [
        { name: 'bootstrap', fn: async () => {} },
        { name: 'discover', fn: async () => {} },
      ] as const);
    } finally {
      (process as { send?: unknown }).send = orig;
    }
    expect(sent).toEqual([
      { type: 'stage', name: 'bootstrap' },
      { type: 'stage', name: 'discover' },
    ]);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pipeline/runner.test.ts -t "emits a"`
Expected: FAIL（`sent` 为空 `[]`，因为 runStages 尚未发事件）

- [ ] **Step 3: 创建 events.ts**

`src/pipeline/events.ts`:

```ts
import type { Stage } from '../state/runs.js';

/**
 * Structured progress events emitted by a run subprocess over the Node IPC
 * channel (process.send). When the run is not forked with an IPC channel
 * (a human running `researcher run` directly), `process.send` is undefined
 * and emitEvent is a no-op — no env var, no mode check.
 *
 * `plan`  — the ordered stage names this run intends to execute (authoritative
 *           denominator for the frontend `(i/n)`); emitted once mode is known.
 * `stage` — a stage just started.
 */
export type RunEvent =
  | { type: 'plan'; stages: Stage[] }
  | { type: 'stage'; name: Stage };

export function emitEvent(ev: RunEvent): void {
  process.send?.(ev);
}
```

- [ ] **Step 4: runStages 调用 emitEvent**

`src/pipeline/runner.ts` —— 顶部加 import，并在 `markStart` 后发 stage 事件：

```ts
import type { RunDir, Stage } from '../state/runs.js';
import type { InvokeResult } from '../adapter/interface.js';
import { emitEvent } from './events.js';

export interface StageDef {
  name: Stage;
  fn: () => Promise<void>;
}

export async function runStages(rd: RunDir, stages: readonly StageDef[]): Promise<void> {
  for (const s of stages) {
    rd.markStart(s.name);
    emitEvent({ type: 'stage', name: s.name });
    await s.fn();
    rd.markDone(s.name);
  }
}
```

（`assertAgentOk` 保持不变。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/pipeline/runner.test.ts`
Expected: PASS（含新测试与原有两个 runStages 测试）

- [ ] **Step 6: run.ts 在两个分支发 plan 事件**

`src/commands/run.ts` —— 顶部加 import：

```ts
import { emitEvent } from '../pipeline/events.js';
```

feed 分支：在构建好 `feedStages` 之后、`await runStages(runDir, feedStages)` 之前插入（当前约 `:106-107`）：

```ts
      feedStages.push({ name: 'package', fn: async () => feedPackage(ctx!) });
      emitEvent({ type: 'plan', stages: ['bootstrap', 'soul', ...feedStages.map((s) => s.name)] });
      await runStages(runDir, feedStages);
```

arxiv 分支：在 `hasRealQueries` 检查通过之后、`await runStages(runDir, [{ name: 'discover', ... }])` 之前插入（当前约 `:126-127`）：

```ts
    emitEvent({
      type: 'plan',
      stages: ['bootstrap', 'soul', 'discover', 'read', 'synthesize', 'package'],
    });
    await runStages(runDir, [
      { name: 'discover', fn: async () => discoverTriage(ctx!) },
    ]);
```

> 说明：bootstrap/soul 在 plan 发出前就已运行（其 stage 事件先到），plan 之后才知模式与分母 —— 前端在收到 plan 前对 bootstrap/soul 只显示阶段名。arxiv 的 plan 乐观包含 read/synthesize/package；无候选时 run 在 discover 后正常结束，前端停在 `discover (3/6)` 转 done。

- [ ] **Step 7: 在既有 full-chain 测试上加 plan/stage 断言**

`tests/commands/run.test.ts` —— 修改 `it('runs the full discover→read→synth→package chain ...')`（`:124-146`），用 process.send spy 包住 `runRun`，并加断言：

```ts
  it('runs the full discover→read→synth→package chain when discover finds a deep-read pick', async () => {
    const adapter = new ScriptedAdapter([
      soulStep(),
      discoverStep(triagedDeepRead),
      readStep(),
      synthesizeStep(),
      packageStep(),
    ]);
    const sent: Array<{ type: string; stages?: string[]; name?: string }> = [];
    const orig = process.send;
    (process as { send?: unknown }).send = (m: unknown) => { sent.push(m as never); return true; };
    const { runRun } = await import('../../src/commands/run.js');
    try {
      await runRun({ cwd: proj, adapter });
    } finally {
      (process as { send?: unknown }).send = orig;
    }

    expect(sent).toContainEqual({
      type: 'plan',
      stages: ['bootstrap', 'soul', 'discover', 'read', 'synthesize', 'package'],
    });
    expect(sent).toContainEqual({ type: 'stage', name: 'synthesize' });

    expect(adapter.callCount).toBe(5);
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.55555'); // deep-read pick
    expect(seen).toContain('arxiv:2401.66666'); // skim
    const deepReadLine = seen.split('\n').find((l) => l.includes('arxiv:2401.55555'))!;
    expect(deepReadLine).toContain('RQ1: extends');
    expect(deepReadLine).not.toContain('manual feed');
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim())
      .toMatch(/^researcher\//);
  });
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run tests/commands/run.test.ts tests/pipeline/runner.test.ts`
Expected: PASS（注意：run.test.ts 命中真实网络已被 mock，离线可跑）

- [ ] **Step 9: 提交**

```bash
git add src/pipeline/events.ts src/pipeline/runner.ts src/commands/run.ts tests/pipeline/runner.test.ts tests/commands/run.test.ts
git commit -m "feat(pipeline): emit structured run events (plan + stage) over IPC (#33)"
```

---

### Task 2: TaskRegistry 承载事件、startedAt、activeTask；defaultRunner 改 fork IPC

**Files:**
- Modify: `src/web/tasks.ts`（全文，约 97 行）
- Test: `tests/web/tasks.test.ts`

**Interfaces:**
- Consumes: `RunEvent`（`src/pipeline/events.ts`）、`Stage`（`src/state/runs.ts`）
- Produces:
  - `type Runner = (cwd: string, onLine: (line: string) => void, onEvent: (ev: RunEvent) => void) => Promise<number>`
  - `interface RunTask { id; slug; lines; status; exitCode; startedAt: number; plan: Stage[] | null; stage: Stage | null }`
  - `TaskRegistry.activeTask(slug: string): RunTask | undefined`
  - `TaskRegistry.subscribe(id, onLine, onEvent, onEnd): () => void`（新增第 3 个参数 `onEvent`）

- [ ] **Step 1: 写失败测试 —— 事件更新 task、activeTask、subscribe 回放**

在 `tests/web/tasks.test.ts` 顶部，把 `fakeRunner` 扩展为可发事件（追加可选 `events` 参数；签名加 `onEvent`）：

```ts
import type { RunEvent } from '../../src/pipeline/events.js';

// A controllable fake runner: emits the given lines (and optional events) then exits with `code`.
function fakeRunner(lines: string[], code = 0, delayMs = 0, events: RunEvent[] = []): Runner {
  return async (_cwd, onLine, onEvent) => {
    for (const e of events) onEvent(e);
    for (const l of lines) { onLine(l); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); }
    return code;
  };
}
```

在 `describe('TaskRegistry', ...)` 内追加：

```ts
  it('records startedAt and updates plan/stage from events', async () => {
    const reg = new TaskRegistry({
      runner: fakeRunner(['a'], 0, 0, [
        { type: 'plan', stages: ['bootstrap', 'soul', 'discover'] },
        { type: 'stage', name: 'discover' },
      ]),
      idSeq,
    });
    const before = Date.now();
    const task = reg.start('trace', '/ws/trace');
    expect(task.startedAt).toBeGreaterThanOrEqual(before);
    await new Promise((r) => setTimeout(r, 10));
    const t = reg.get(task.id)!;
    expect(t.plan).toEqual(['bootstrap', 'soul', 'discover']);
    expect(t.stage).toBe('discover');
  });

  it('activeTask returns the running task for a slug, undefined once finished', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['x'], 0, 50), idSeq });
    const task = reg.start('trace', '/ws/trace');
    expect(reg.activeTask('trace')?.id).toBe(task.id);
    expect(reg.activeTask('other')).toBeUndefined();
    await new Promise((r) => setTimeout(r, 80));
    expect(reg.activeTask('trace')).toBeUndefined();
  });

  it('replays plan and current stage to a late subscriber', async () => {
    const reg = new TaskRegistry({
      runner: fakeRunner(['one'], 0, 0, [
        { type: 'plan', stages: ['bootstrap', 'discover'] },
        { type: 'stage', name: 'discover' },
      ]),
      idSeq,
    });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    const events: RunEvent[] = [];
    reg.subscribe(task.id, () => {}, (e) => events.push(e), () => {});
    expect(events).toContainEqual({ type: 'plan', stages: ['bootstrap', 'discover'] });
    expect(events).toContainEqual({ type: 'stage', name: 'discover' });
  });
```

并更新既有用到 `subscribe` 的测试（`'replays buffered lines and signals end to a late subscriber'`）以匹配新签名（中间插入一个 no-op `onEvent`）：

```ts
    reg.subscribe(task.id, (l) => got.push(l), () => {}, () => { ended = true; });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/web/tasks.test.ts`
Expected: FAIL（`startedAt`/`plan`/`stage`/`activeTask` 未定义；subscribe 参数不匹配）

- [ ] **Step 3: 重写 src/web/tasks.ts**

```ts
import { fork } from 'node:child_process';
import type { RunEvent } from '../pipeline/events.js';
import type { Stage } from '../state/runs.js';

export type Runner = (
  cwd: string,
  onLine: (line: string) => void,
  onEvent: (ev: RunEvent) => void,
) => Promise<number>;

export interface RunTask {
  id: string;
  slug: string;
  lines: string[];
  status: 'running' | 'done' | 'error';
  exitCode: number | null;
  startedAt: number;
  plan: Stage[] | null;
  stage: Stage | null;
}

interface Listener {
  onLine: (line: string) => void;
  onEvent: (ev: RunEvent) => void;
  onEnd: (t: RunTask) => void;
}

let globalSeq = 0;
const defaultIdSeq = () => `task-${++globalSeq}`;

/**
 * Default runner: fork this CLI's `run` as a child process. stdout+stderr are
 * piped and split into log lines; structured stage/plan events arrive over the
 * Node IPC channel (the child calls process.send) — kept off stdout so the two
 * never collide and need no ordering guarantee.
 */
export function defaultRunner(cliEntry: string): Runner {
  return (cwd, onLine, onEvent) =>
    new Promise<number>((resolve) => {
      const child = fork(cliEntry, ['run'], { cwd, silent: true });
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('message', (msg) => onEvent(msg as RunEvent));
      child.on('exit', (code) => { if (buf.length) onLine(buf); resolve(code ?? 0); });
      child.on('error', () => { if (buf.length) onLine(buf); resolve(1); });
    });
}

export class TaskRegistry {
  private readonly runner: Runner;
  private readonly bufferLines: number;
  private readonly idSeq: () => string;
  private readonly tasks = new Map<string, RunTask>();
  private readonly busy = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(opts?: { runner?: Runner; bufferLines?: number; idSeq?: () => string }) {
    this.runner = opts?.runner ?? defaultRunner(process.argv[1] ?? '');
    this.bufferLines = opts?.bufferLines ?? 2000;
    this.idSeq = opts?.idSeq ?? defaultIdSeq;
  }

  isBusy(slug: string): boolean {
    return this.busy.has(slug);
  }

  /** The running task for a slug, if any — used to reconnect after a page refresh. */
  activeTask(slug: string): RunTask | undefined {
    for (const t of this.tasks.values()) {
      if (t.slug === slug && t.status === 'running') return t;
    }
    return undefined;
  }

  start(slug: string, cwd: string): RunTask {
    if (this.isBusy(slug)) throw new Error('busy');
    const task: RunTask = {
      id: this.idSeq(), slug, lines: [], status: 'running', exitCode: null,
      startedAt: Date.now(), plan: null, stage: null,
    };
    this.tasks.set(task.id, task);
    this.busy.add(slug);
    this.listeners.set(task.id, new Set());

    const onLine = (line: string) => {
      task.lines.push(line);
      if (task.lines.length > this.bufferLines) task.lines.shift();
      for (const l of this.listeners.get(task.id) ?? []) l.onLine(line);
    };
    const onEvent = (ev: RunEvent) => {
      if (ev.type === 'plan') task.plan = ev.stages;
      else if (ev.type === 'stage') task.stage = ev.name;
      for (const l of this.listeners.get(task.id) ?? []) l.onEvent(ev);
    };
    this.runner(cwd, onLine, onEvent).then(
      (code) => this.finish(task, code),
      () => this.finish(task, 1),
    );
    return task;
  }

  private finish(task: RunTask, code: number): void {
    task.exitCode = code;
    task.status = code === 0 ? 'done' : 'error';
    this.busy.delete(task.slug);
    for (const l of this.listeners.get(task.id) ?? []) l.onEnd(task);
  }

  get(id: string): RunTask | undefined {
    return this.tasks.get(id);
  }

  subscribe(
    id: string,
    onLine: (line: string) => void,
    onEvent: (ev: RunEvent) => void,
    onEnd: (t: RunTask) => void,
  ): () => void {
    const task = this.tasks.get(id);
    if (!task) return () => {};
    if (task.plan) onEvent({ type: 'plan', stages: task.plan });   // replay current
    if (task.stage) onEvent({ type: 'stage', name: task.stage });
    for (const l of task.lines) onLine(l);                          // replay buffer
    if (task.status !== 'running') { onEnd(task); return () => {}; }
    const listener: Listener = { onLine, onEvent, onEnd };
    this.listeners.get(id)!.add(listener);
    return () => this.listeners.get(id)?.delete(listener);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/web/tasks.test.ts`
Expected: PASS（全部 TaskRegistry 测试）

- [ ] **Step 5: 提交**

```bash
git add src/web/tasks.ts tests/web/tasks.test.ts
git commit -m "feat(web): TaskRegistry carries plan/stage events, startedAt, activeTask; fork IPC runner (#33)"
```

---

### Task 3: 服务端 SSE 转发事件 + topic 页内嵌 active run；renderTopic 渲染弹层骨架

**Files:**
- Modify: `src/web/server.ts:53-101`（SSE 订阅与 GET topic）
- Modify: `src/web/views.ts:133-194`（`renderTopic` 签名与按钮/弹层骨架）
- Test: `tests/web/views.test.ts`、`tests/web/server.test.ts`

**Interfaces:**
- Consumes: `TaskRegistry.activeTask`、`subscribe(id, onLine, onEvent, onEnd)`、`RunTask.startedAt`
- Produces: `function renderTopic(v: TopicView, activeRun?: { taskId: string; startedAt: number } | null): string`

- [ ] **Step 1: 写失败测试 —— renderTopic 内嵌 active run + 弹层骨架**

在 `tests/web/views.test.ts` 末尾追加（若已有 `describe('renderTopic', ...)` 则并入）：

```ts
describe('renderTopic run controls', () => {
  const baseView: TopicView = {
    slug: 'trace', path: 'trace', available: true, oneline: 'o', language: 'zh',
    sources: [], researchQuestions: [], docs: [], papers: [], seen: [], watermark: null,
  };

  it('renders the run popover skeleton', () => {
    const html = renderTopic(baseView);
    expect(html).toContain('id="run-pop"');
    expect(html).toContain('id="run-stages"');
    expect(html).toContain('id="run-out"');
    expect(html).not.toContain('data-active-task');
  });

  it('embeds the active run when one is passed', () => {
    const html = renderTopic(baseView, { taskId: 'task-7', startedAt: 1719000000000 });
    expect(html).toContain('data-active-task="task-7"');
    expect(html).toContain('data-started-at="1719000000000"');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/web/views.test.ts -t "run controls"`
Expected: FAIL（无 `id="run-pop"` / `data-active-task`）

- [ ] **Step 3: 修改 renderTopic 签名与骨架**

`src/web/views.ts` —— 改 `renderTopic` 签名（`:133`）：

```ts
export function renderTopic(
  v: TopicView,
  activeRun: { taskId: string; startedAt: number } | null = null,
): string {
```

把按钮（`:173`）替换为包了弹层的 `.run-wrap`：

```ts
  const runAttrs = activeRun
    ? ` data-active-task="${escapeHtml(activeRun.taskId)}" data-started-at="${activeRun.startedAt}"`
    : '';
  const runWrap =
    `<div class="run-wrap" id="run-wrap">` +
    `<button id="run-btn" data-slug="${v.slug}" data-run="/t/${v.slug}/run" aria-expanded="false"${runAttrs}>Run</button>` +
    `<div id="run-pop" class="run-pop" hidden>` +
      `<div class="run-bar">` +
        `<span id="run-status" class="run-status">idle</span>` +
        `<span id="run-elapsed" class="run-elapsed mono"></span>` +
        `<button id="run-hide" class="run-hide" type="button">hide</button>` +
      `</div>` +
      `<ol id="run-stages" class="run-stages"></ol>` +
      `<pre id="run-out"></pre>` +
    `</div></div>`;
```

在 `body` 模板里：把 topbar 末尾的 `<button id="run-btn" ...>Run</button>` 替换为 `${runWrap}`（`:173`），并**删除**底部独立的 `#run-log` 块（`:186-191` 的 `<div id="run-log" ...>…</pre></div>`）。topbar 现在以 `${runWrap}` 收尾，`<script>${TOPIC_JS}</script>` 保留。

替换后的 `body` 末段应为：

```ts
    `<span class="root">${escapeHtml(v.path)}</span>` +
    `${runWrap}</header>` +
    `<main class="three-col">` +
      // ... 三栏不变 ...
    `</main>` +
    `<script>${TOPIC_JS}</script>`;
  return page(`${v.path} · researcher`, body);
```

> TOPIC_JS 的内容在 Task 4 重写；本步只改骨架与签名。

- [ ] **Step 4: 运行 views 测试确认通过**

Run: `npx vitest run tests/web/views.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试 —— SSE 转发 stage 事件**

`tests/web/server.test.ts` —— 把 `beforeAll` 里的 fake runner 改为同时发一个 stage 事件（`:35`）：

```ts
  const registry = new TaskRegistry({
    runner: async (_c, onLine, onEvent) => {
      onEvent({ type: 'plan', stages: ['bootstrap', 'discover'] });
      onEvent({ type: 'stage', name: 'discover' });
      onLine('hello');
      return 0;
    },
    idSeq: (() => { let n = 0; return () => `t${++n}`; })(),
  });
```

并扩展既有 SSE 测试（`:61-69`）的断言：

```ts
it('starts a run and streams via SSE', async () => {
  const res = await fetch(base + '/t/trace/run', { method: 'POST' });
  expect(res.status).toBe(200);
  const { taskId } = await res.json();
  const sse = await fetch(base + `/t/trace/run/${taskId}/stream`);
  const text = await sse.text();
  expect(text).toContain('hello');
  expect(text).toContain('event: stage');
  expect(text).toContain('event: plan');
  expect(text).toContain('event: end');
});
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npx vitest run tests/web/server.test.ts -t "streams via SSE"`
Expected: FAIL（无 `event: stage` / `event: plan`）

- [ ] **Step 7: server.ts —— SSE 转发事件 + GET topic 内嵌 active run**

`src/web/server.ts` —— GET topic（`:60-64`）改为查 activeTask 并传入：

```ts
    // GET /t/:slug — uses loadTopic which already null-guards against the manifest
    if (req.method === 'GET' && !sub) {
      const view = loadTopic(root, slug);
      if (!view) return send(res, 404, 'text/plain', 'unknown topic');
      const active = registry.activeTask(decodeURIComponent(slug));
      const activeRun = active ? { taskId: active.id, startedAt: active.startedAt } : null;
      return send(res, 200, 'text/html; charset=utf-8', renderTopic(view, activeRun));
    }
```

SSE 订阅（`:92-100`）加 `onEvent`（subscribe 第 3 个参数），转发为 `event: <type>`：

```ts
    // GET /t/:slug/run/:taskId/stream  (SSE)
    if (req.method === 'GET' && taskId) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const unsub = registry.subscribe(
        taskId,
        (line) => res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`),
        (ev) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
        () => { res.write(`event: end\ndata: {}\n\n`); res.end(); },
      );
      req.on('close', unsub);
      return;
    }
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run tests/web/server.test.ts tests/web/views.test.ts`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add src/web/server.ts src/web/views.ts tests/web/server.test.ts tests/web/views.test.ts
git commit -m "feat(web): forward run events over SSE + embed active run in topic page (#33)"
```

---

### Task 4: 前端按钮状态机 + 锚定弹层 + 刷新重连（TOPIC_JS + CSS）

**Files:**
- Modify: `src/web/views.ts:196-253`（`TOPIC_JS` 常量整体替换）
- Modify: `src/web/static/app.css:57-66`（`#run-btn`）与 `:256-287`（run log → run popover）
- 手动验证（无浏览器测试环境）

**Interfaces:**
- Consumes: SSE 事件 `plan` / `stage` / `line` / `end`；按钮 data 属性 `data-slug` / `data-active-task` / `data-started-at`；DOM id `run-btn` / `run-pop` / `run-out` / `run-stages` / `run-status` / `run-elapsed` / `run-hide` / `run-wrap`

- [ ] **Step 1: 整体替换 TOPIC_JS**

`src/web/views.ts` —— 用以下内容替换 `const TOPIC_JS = \`...\`;`（`:196-253`）：

```ts
const TOPIC_JS = `
const slug = document.getElementById('run-btn')?.dataset.slug;
document.querySelectorAll('.doc-link').forEach(a => a.addEventListener('click', async (e) => {
  e.preventDefault();
  const res = await fetch('/t/' + slug + '/doc?path=' + a.dataset.path);
  document.getElementById('reader').innerHTML = await res.text();
}));

const runBtn = document.getElementById('run-btn');
const pop = document.getElementById('run-pop');
const out = document.getElementById('run-out');
const stagesEl = document.getElementById('run-stages');
const statusEl = document.getElementById('run-status');
const elapsedEl = document.getElementById('run-elapsed');
const wrap = document.getElementById('run-wrap');

let running = false, plan = null, current = null, timer = null;

function fmtElapsed(s) {
  const m = Math.floor(s / 60), ss = s % 60;
  return m ? m + 'm' + String(ss).padStart(2, '0') + 's' : ss + 's';
}
function setBtnLabel() {
  if (!running) { runBtn.textContent = 'Run'; return; }
  const i = (plan && current) ? plan.indexOf(current) : -1;
  runBtn.textContent = i >= 0
    ? '\\u27f3 ' + current + ' (' + (i + 1) + '/' + plan.length + ')'
    : '\\u27f3 ' + (current || 'starting');
}
function renderStages() {
  if (!plan) { stagesEl.innerHTML = ''; return; }
  const ci = current ? plan.indexOf(current) : -1;
  stagesEl.innerHTML = plan.map((name, i) => {
    let cls = 'pending', mk = '\\u00b7';
    if (ci >= 0 && i < ci) { cls = 'done'; mk = '\\u2713'; }
    else if (i === ci) { cls = 'active'; mk = '\\u27f3'; }
    return '<li class="' + cls + '"><span class="mk">' + mk + '</span>' + name + '</li>';
  }).join('');
}
const append = (t) => { out.textContent += t; out.scrollTop = out.scrollHeight; };
function openPop() { pop.hidden = false; runBtn.setAttribute('aria-expanded', 'true'); }
function closePop() { pop.hidden = true; runBtn.setAttribute('aria-expanded', 'false'); }

function startTimer(t0) {
  const tick = () => { elapsedEl.textContent = fmtElapsed(Math.floor((Date.now() - t0) / 1000)); };
  tick();
  timer = setInterval(tick, 1000);
}
function finish(label, cls) {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  current = null;
  statusEl.textContent = label; statusEl.className = 'run-status ' + cls;
  renderStages(); setBtnLabel();
  runBtn.classList.remove('is-running');
}

function subscribe(taskId, t0) {
  running = true;
  runBtn.classList.add('is-running');
  statusEl.textContent = 'running'; statusEl.className = 'run-status running';
  startTimer(t0); setBtnLabel();
  const es = new EventSource('/t/' + slug + '/run/' + taskId + '/stream');
  es.addEventListener('plan', (ev) => { plan = JSON.parse(ev.data).stages; renderStages(); setBtnLabel(); });
  es.addEventListener('stage', (ev) => { current = JSON.parse(ev.data).name; renderStages(); setBtnLabel(); });
  es.addEventListener('line', (ev) => append(JSON.parse(ev.data) + '\\n'));
  es.addEventListener('end', () => { es.close(); append('\\n\\u2713 run finished.\\n'); finish('done', 'ok'); });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { append('\\n\\u2717 connection closed.\\n'); finish('disconnected', 'err'); } };
}

async function startRun() {
  out.textContent = ''; plan = null; current = null; stagesEl.innerHTML = '';
  openPop();
  running = true; runBtn.classList.add('is-running');
  statusEl.textContent = 'starting'; statusEl.className = 'run-status running';
  setBtnLabel();
  try {
    const res = await fetch('/t/' + slug + '/run', { method: 'POST' });
    if (res.status === 409) { append('A run is already in progress for this topic.\\n'); finish('busy', 'err'); return; }
    if (!res.ok) { append('Could not start run (HTTP ' + res.status + ').\\n'); finish('failed', 'err'); return; }
    const { taskId } = await res.json();
    append('\\u25b6 run started — stages call the model and can be quiet for minutes.\\n   Safe to leave this open; the elapsed clock shows it is still alive.\\n\\n');
    subscribe(taskId, Date.now());
  } catch (err) {
    append('\\n\\u2717 ' + (err && err.message ? err.message : err) + '\\n');
    finish('error', 'err');
  }
}

if (runBtn) runBtn.addEventListener('click', () => {
  if (running) { pop.hidden ? openPop() : closePop(); return; }
  startRun();
});
document.getElementById('run-hide')?.addEventListener('click', closePop);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) closePop(); });
document.addEventListener('click', (e) => {
  if (pop && !pop.hidden && wrap && !wrap.contains(e.target)) closePop();
});

// Reconnect to an in-flight run after a page refresh — same subscribe path, popover stays collapsed.
if (runBtn && runBtn.dataset.activeTask) {
  append('\\u00b7 reconnected to a run in progress.\\n\\n');
  subscribe(runBtn.dataset.activeTask, Number(runBtn.dataset.startedAt));
}
`;
```

- [ ] **Step 2: 改 #run-btn 样式（移出 margin-left，加 is-running 态）**

`src/web/static/app.css` —— 把 `#run-btn { ... }` 块（`:57-66`）替换为：

```css
.run-wrap { margin-left:auto; position:relative; }
#run-btn {
  font:600 13px var(--sans);
  padding:7px 16px; border:1px solid var(--accent);
  background:var(--accent); color:#fff; border-radius:6px; cursor:pointer;
  transition:background .15s, transform .05s;
  font-variant-numeric:tabular-nums;
}
#run-btn:hover { background:var(--accent-ink); }
#run-btn:active { transform:translateY(1px); }
#run-btn:disabled { opacity:.5; cursor:default; }
#run-btn.is-running {
  background:#2c281f; border-color:#3a342a; color:#cdc3aa;
}
```

- [ ] **Step 3: 把 “run log” 样式段改为 “run popover”**

`src/web/static/app.css` —— 把 `/* run log */` 整段（`:256-287`，从 `.run-log {` 到 `@media (prefers-reduced-motion: reduce) { .run-status.running::before { animation:none; } }`）替换为：

```css
/* run popover */
.run-pop {
  position:absolute; top:calc(100% + 8px); right:0; width:min(440px, 92vw);
  max-height:62vh; display:flex; flex-direction:column; overflow:hidden;
  background:#1c1a14; color:#d9d2bf; border:1px solid #2c281f; border-radius:8px;
  box-shadow:0 16px 40px -12px rgba(0,0,0,.55); z-index:50;
}
.run-bar {
  display:flex; align-items:center; gap:12px;
  padding:9px 14px; background:#16140f; border-bottom:1px solid #2c281f;
}
.run-status {
  font:600 10px/1 var(--mono); text-transform:uppercase; letter-spacing:.12em;
  padding:4px 9px; border-radius:4px; display:inline-flex; align-items:center; gap:7px;
  background:#2c281f; color:#b7ad95;
}
.run-status::before { content:""; width:7px; height:7px; border-radius:50%; background:currentColor; }
.run-status.running { color:#7fc99a; }
.run-status.running::before { animation:run-pulse 1.1s ease-in-out infinite; }
.run-status.ok { color:#7fc99a; }
.run-status.err { color:#e08a7d; }
@keyframes run-pulse { 0%,100% { opacity:1; } 50% { opacity:.25; } }
.run-elapsed { font-size:12px; color:#a59a82; font-variant-numeric:tabular-nums; }
.run-hide {
  margin-left:auto; font:600 11px var(--mono); color:#a59a82;
  background:none; border:1px solid #3a342a; padding:4px 10px; border-radius:5px; cursor:pointer;
}
.run-hide:hover { color:#e6dfca; border-color:#5a5142; }
.run-stages {
  list-style:none; margin:0; padding:10px 14px; border-bottom:1px solid #2c281f;
  font:12px/1.7 var(--mono);
}
.run-stages li { display:flex; gap:8px; color:#6f685a; }
.run-stages li .mk { width:12px; text-align:center; }
.run-stages li.done { color:#7fc99a; }
.run-stages li.active { color:#e6dfca; }
.run-stages li.active .mk { animation:run-pulse 1.1s ease-in-out infinite; }
#run-out {
  margin:0; padding:14px 18px; flex:1; min-height:80px; overflow:auto;
  font:12px/1.55 var(--mono); white-space:pre-wrap;
}
@media (prefers-reduced-motion: reduce) {
  .run-status.running::before, .run-stages li.active .mk { animation:none; }
}
```

- [ ] **Step 4: 构建并确认无 TS/打包错误**

Run: `npm run build`
Expected: 构建成功；`dist/web/static/app.css` 已拷贝（既有 build 流程负责）。

- [ ] **Step 5: 全量测试回归**

Run: `npx vitest run`
Expected: 全绿（含改动过的 runner/tasks/server/views 套件）。

- [ ] **Step 6: 手动验证（真实浏览器）**

```bash
# 在一个声明了 topic 的 workspace 超级仓库根目录下：
node dist/cli.js serve --port 8787
```
逐项确认：
1. 打开某 topic 页 → 点 `Run`：按钮变 `⟳ <stage>`，弹层自动展开，顶部 `running` 脉冲 + elapsed 走字；bootstrap/soul 阶段按钮无分数，进入 discover 后变 `⟳ discover (3/6)`，阶段清单出现 ✓/⟳/· 标记。
2. 点击运行中的按钮 → 弹层收起；再点 → 展开（不会重复启动）。`hide` / 点击弹层外 / Esc 均能收起。
3. 运行中**刷新页面** → 按钮立刻回到 `⟳ <stage> (i/n)` 运行态、elapsed 连续（不归零），点击展开可见阶段清单 + 已回放的日志 + “reconnected” 提示。
4. 运行结束（或刷新于已结束后）→ 按钮回 `Run`，弹层状态显示 `done`/`ok`；再次刷新页面显示 idle（无 active）。
5. arxiv 无候选时：停在 `discover (3/6)` 后转 `done`，日志含 “no deep-read candidate”。

- [ ] **Step 7: 提交**

```bash
git add src/web/views.ts src/web/static/app.css
git commit -m "feat(web): run button live stage progress + collapsible popover + refresh reconnect (#33)"
```

---

## Self-Review

**1. Spec coverage（对照 issue #33）：**
- 按钮运行态 + `(i/n)` → Task 4 Step 1（`setBtnLabel`）、Task 1（plan/stage 事件源）。✓
- 点击展开可收起弹层 → Task 4（`openPop`/`closePop`/状态机）、Task 3（骨架）。✓
- 阶段清单 ✓/⟳/· → Task 4（`renderStages`）。注：plan 只含将运行的阶段，故“跳过”态退化为“不出现在清单”，比显式 skipped 更简洁（与 issue 描述一致取舍）。✓
- 后端权威 index/total，前端不解析文本 → Task 1（plan 事件）、Task 4（仅消费 typed 事件）。✓
- fork + IPC，无 env var/无分支 → Task 2（`fork` + `process.send?.`）。✓
- 刷新重连，效果一致 → Task 2（activeTask/startedAt/replay）、Task 3（SSR 内嵌）、Task 4（加载时 subscribe）。✓
- 移除底部 #run-log，统一收进弹层 → Task 3 Step 3。✓
- 范围外（serve 重启/多实例、每阶段计时、CLI 美化）→ 未实现，符合预期。✓

**2. Placeholder scan：** 无 TBD/TODO；所有步骤含完整代码或精确命令与预期。✓

**3. Type consistency：**
- `RunEvent`（events.ts）→ tasks.ts `Runner`/`onEvent`/`subscribe` → server.ts SSE 转发 → 前端 `plan`/`stage` 监听，名称一致。✓
- `subscribe(id, onLine, onEvent, onEnd)` 新签名在 tasks.ts 定义、server.ts 与 tasks.test.ts 调用处一致更新。✓
- `renderTopic(v, activeRun?)` 在 views.ts 定义、server.ts 调用、views.test.ts 断言一致。✓
- `RunTask.startedAt/plan/stage` 在 tasks.ts 定义并被 server.ts（startedAt）与 subscribe 回放使用。✓
- DOM id（run-btn/run-pop/run-out/run-stages/run-status/run-elapsed/run-hide/run-wrap）在 Task 3 骨架与 Task 4 JS/CSS 间一致。✓
