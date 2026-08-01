# Workspace Publish Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `workspace publish` 改为逐 topic 默认拒绝、单次显式确认、失败可重试的高危操作，同时修复 topic 仓库误识别、自动提交夹带 staged 内容和 remote 凭证泄漏。

**Architecture:** manifest 的 `topics[].publish` 提供长期授权；`prepareWorkspacePublish` 只读地产生可展示计划，CLI 完成 TTY/`--yes` 单次确认后调用 `executeWorkspacePublish`。Git 写入前验证仓库边界与 super-repo 状态；执行失败恢复本次 origin、`.gitmodules` 和 index 变更。sync pointer 与 publish 自动提交都拒绝夹带用户既有 staged 内容。

**Tech Stack:** TypeScript 6、Commander 14、Zod 4、Execa 9、Vitest 3、Node.js `readline/promises`、Git CLI。

## Global Constraints

- `publish` 默认关闭；只有目标 manifest topic 的 `publish: true` 可以授权写操作。
- `--yes` 只跳过单次人工确认，不能绕过 allowlist、仓库边界、clean-index 或 remote 校验；不增加 `--force`。
- 非 TTY 未带 `--yes` 必须拒绝；TTY 默认 No。
- `--dry-run` 永不写入；未授权时输出 `blocked: publish not enabled`，退出 0。
- 自动提交不得包含用户预先 staged 的内容；publish 遇到 dirty `.gitmodules` 必须拒绝。
- topic 必须是 workspace 内的独立 Git top-level；普通 super-repo 子目录不能继承父仓库的 branch、HEAD 或 origin。
- stdout/stderr、计划和错误不得输出 remote URL userinfo/token。
- publish 失败必须恢复本次本地 origin、`.gitmodules` 和 index 变更；已完成的远端 push 不回滚，但同一命令必须可重试。
- 不改变 `run`、`delivery.mode` 或 `sync` 的默认动作。

---

### Task 1: Manifest 授权与独立仓库分类

**Files:**
- Modify: `src/workspace/manifest.ts:15-20`
- Modify: `src/workspace/topic-git.ts:17-25,73-90`
- Test: `tests/workspace/sync.test.ts`

**Interfaces:**
- Produces: `WorkspaceTopic.publish: boolean`，由 Zod 缺省为 `false`。
- Produces: `classifyTopicGit(root, relPath)` 仅在 `realpath(git rev-parse --show-toplevel) === realpath(absPath)` 时返回 git topic kind。
- Consumes: 现有 `WorkspaceManifestSchema`、`TopicGitInfo`。

- [ ] **Step 1: 写 manifest 默认拒绝和普通子目录分类失败测试**

在 `tests/workspace/sync.test.ts` 增加：

```ts
import { loadWorkspaceManifest } from '../../src/workspace/manifest.js';

it('defaults per-topic publish permission to false', () => {
  const root = mkdtempSync(join(tmpdir(), 'r-publish-policy-'));
  writeManifest(root, [{ path: 'topic' }]);
  expect(loadWorkspaceManifest(join(root, 'researcher.workspace.yml')).topics[0]).toEqual({
    path: 'topic',
    active: true,
    publish: false,
  });
});

it('does not classify a plain super-repo directory as a topic repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'r-classify-plain-'));
  gitInit(root);
  mkdirSync(join(root, 'plain'));
  writeFileSync(join(root, 'plain', 'file'), 'x');
  gitCommitAll(root, 'super with plain directory');
  expect(classifyTopicGit(root, 'plain')).toEqual(
    expect.objectContaining({ kind: 'not-git', reason: 'not an independent git repository' }),
  );
});
```

同时让测试 helper 支持显式授权：

```ts
function writeManifest(
  root: string,
  topics: Array<{ path: string; active?: boolean; publish?: boolean }>,
): void {
  const body =
    'version: 1\ntopics:\n' +
    topics
      .map(
        (t) =>
          `  - { path: ${t.path}, active: ${t.active ?? true}, publish: ${t.publish ?? false} }\n`,
      )
      .join('');
  writeFileSync(join(root, 'researcher.workspace.yml'), body);
}
```

- [ ] **Step 2: 运行测试并确认当前实现失败**

Run: `npx vitest run tests/workspace/sync.test.ts -t "publish permission|plain super-repo"`

Expected: 两项 FAIL；manifest 没有 `publish`，普通目录被识别为 `local-only` 或 `remote`。

- [ ] **Step 3: 增加 schema 字段和 top-level 边界检查**

在 `src/workspace/manifest.ts` 的 `Topic` schema 增加：

```ts
/** Whether this topic may be promoted to a remote submodule. */
publish: z.boolean().default(false),
```

同时扩展 `addTopicToManifest` 输入为 `{ path: string; active?: boolean; publish?: boolean }`，写入新 topic 时使用：

```ts
{
  path: topic.path,
  active: topic.active ?? true,
  publish: topic.publish ?? false,
}
```

在 `src/workspace/topic-git.ts` 使用 `realpathSync`，并将仓库检查改为返回精确原因：

```ts
import { existsSync, readFileSync, realpathSync } from 'node:fs';

function isIndependentGitRepo(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    const topLevel = execaSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir }).stdout.trim();
    return realpathSync(topLevel) === realpathSync(dir);
  } catch {
    return false;
  }
}
```

`classifyTopicGit` 中存在但不是独立 top-level 的目录返回：

```ts
return {
  path: relPath,
  absPath,
  kind: 'not-git',
  reason: 'not an independent git repository',
};
```

- [ ] **Step 4: 运行分类与 manifest 测试**

Run: `npx vitest run tests/workspace/sync.test.ts -t "classify|publish permission|plain super-repo"`

Expected: PASS；正规本地仓、remote 仓和 submodule 分类保持通过。

- [ ] **Step 5: 提交**

```bash
git add src/workspace/manifest.ts src/workspace/topic-git.ts tests/workspace/sync.test.ts
git commit -m "fix: enforce workspace topic git boundaries"
```

---

### Task 2: Publish 只读计划、逐 topic 授权与凭证脱敏

**Files:**
- Create: `src/workspace/remote-display.ts`
- Modify: `src/workspace/publish.ts`
- Test: `tests/workspace/sync.test.ts`

**Interfaces:**
- Produces: `sanitizeRemoteForDisplay(remote: string): string`，移除 URL/scp-like remote 的 userinfo。
- Produces: `prepareWorkspacePublish(opts: PublishOptions): PublishPlan`，只读返回 `authorized`、`blockedReason`、branch/HEAD 和脱敏 remote。
- Produces: `executeWorkspacePublish(plan: PublishPlan): Promise<PublishResult>`，运行时再次拒绝未授权 plan。
- Removes: `publishWorkspaceTopic(opts)`；所有调用方在 Task 4 一次性迁移，不保留兼容 shim。

- [ ] **Step 1: 写未授权计划、脱敏和越界 path 测试**

在 `tests/workspace/sync.test.ts` 增加：

```ts
import { prepareWorkspacePublish } from '../../src/workspace/publish.js';
import { sanitizeRemoteForDisplay } from '../../src/workspace/remote-display.js';

it('prepares a blocked plan when publish is not enabled', () => {
  const { root } = makeLocalPublishFixture({ publish: false });
  const plan = prepareWorkspacePublish({
    cwd: root,
    path: 'topic',
    remote: 'https://secret@example.com/org/topic.git',
  });
  expect(plan).toEqual(
    expect.objectContaining({
      authorized: false,
      blockedReason: 'publish not enabled',
      displayRemote: 'https://example.com/org/topic.git',
    }),
  );
});

it.each([
  ['https://token@example.com/org/repo.git', 'https://example.com/org/repo.git'],
  ['https://user:token@example.com/org/repo.git', 'https://example.com/org/repo.git'],
  ['git@example.com:org/repo.git', 'example.com:org/repo.git'],
])('redacts remote userinfo from %s', (input, expected) => {
  expect(sanitizeRemoteForDisplay(input)).toBe(expected);
});

it('rejects a manifest topic that resolves outside the workspace', () => {
  const { root } = makeLocalPublishFixture({ path: '../outside', publish: true });
  expect(() =>
    prepareWorkspacePublish({ cwd: root, path: '../outside', remote: '/tmp/topic.git' }),
  ).toThrow(/inside workspace/i);
});
```

`makeLocalPublishFixture` 必须创建 super-repo、manifest、独立 local topic 和首个 commit，并返回 `{ root, topic }`；参数精确为 `{ path?: string; publish: boolean }`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/workspace/sync.test.ts -t "blocked plan|redacts remote|outside the workspace"`

Expected: FAIL，缺少新接口和脱敏模块。

- [ ] **Step 3: 实现 remote 显示脱敏**

创建 `src/workspace/remote-display.ts`：

```ts
export function sanitizeRemoteForDisplay(remote: string): string {
  try {
    const url = new URL(remote);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return remote.replace(/^[^/@\s]+@([^:\s]+:)/, '$1');
  }
}
```

测试若发现 `URL#toString()` 给目标 URL 添加尾 `/`，按输入是否有 pathname 保持稳定展示；测试期望是契约，不放宽为包含判断。

- [ ] **Step 4: 拆分 publish prepare/execute 契约**

在 `src/workspace/publish.ts` 定义：

```ts
export interface PublishPlan {
  cwd: string;
  path: string;
  absPath: string;
  remote: string;
  displayRemote: string;
  branch: string;
  head: string;
  authorized: boolean;
  blockedReason?: 'publish not enabled';
}

export function prepareWorkspacePublish(opts: PublishOptions): PublishPlan;
export async function executeWorkspacePublish(plan: PublishPlan): Promise<PublishResult>;
```

`prepareWorkspacePublish` 必须：

1. 校验 workspace manifest；
2. 校验 path 无 NUL、绝对路径和 `..`，并用 `resolve` + `relative` 确认目标位于 workspace 内；
3. 校验 path 精确存在于 manifest；
4. 复用 Task 1 的独立仓库分类；
5. 拒绝 submodule、已有 origin、detached HEAD、无 HEAD；
6. 将 `topic.publish` 映射到 `authorized`，但未授权不抛错，以支持 blocked dry-run；
7. 只在 `displayRemote` 使用脱敏值，`remote` 仅保留给 Git argv。

`executeWorkspacePublish` 的第一条运行时检查必须为：

```ts
if (!plan.authorized) {
  throw new WorkspaceSyncError(`topic "${plan.path}" is not enabled for publish`, 2);
}
```

该步骤只建立接口；Git 事务在 Task 4 完成。

- [ ] **Step 5: 运行 publish policy 测试**

Run: `npx vitest run tests/workspace/sync.test.ts -t "blocked plan|redacts remote|outside the workspace"`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/workspace/remote-display.ts src/workspace/publish.ts tests/workspace/sync.test.ts
git commit -m "feat: require per-topic publish authorization"
```

---

### Task 3: 自动提交隔离用户 staged 内容

**Files:**
- Modify: `src/git/workspace-ops.ts`
- Modify: `src/workspace/sync.ts`
- Test: `tests/workspace/sync.test.ts`

**Interfaces:**
- Produces: `listStagedPaths(root: string): Promise<string[]>`。
- Produces: `assertNoStagedChanges(root: string): Promise<void>`，错误文本包含全部既有 staged path。
- Consumes: `bumpPointers` 在 stage gitlink 前调用该 guard。

- [ ] **Step 1: 写 pointer 不得夹带 staged 内容的失败测试**

扩展现有 pointer fixture：在 submodule HEAD 漂移后，先 stage `unrelated.txt`，再执行：

```ts
const before = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
const res = await runWorkspaceSync({ cwd: root, pull: false, pointers: true });
expect(res.pointers).toEqual(
  expect.objectContaining({ status: 'failed', message: expect.stringContaining('unrelated.txt') }),
);
expect(execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()).toBe(before);
expect(execaSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.trim()).toBe(
  'unrelated.txt',
);
```

- [ ] **Step 2: 运行测试并确认当前实现失败**

Run: `npx vitest run tests/workspace/sync.test.ts -t "staged content"`

Expected: FAIL；当前实现创建 commit 并包含 `unrelated.txt`。

- [ ] **Step 3: 增加 clean-index guard 并接入 pointers**

在 `src/git/workspace-ops.ts` 增加：

```ts
export async function listStagedPaths(root: string): Promise<string[]> {
  const { stdout } = await execa('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root });
  return stdout.split('\0').filter(Boolean);
}

export async function assertNoStagedChanges(root: string): Promise<void> {
  const paths = await listStagedPaths(root);
  if (paths.length > 0) {
    throw new Error(`super-repo has staged changes: ${paths.join(', ')}`);
  }
}
```

在 `bumpPointers` 确认 `pending.length > 0` 且不是 dry-run 后、第一次 `stageGitlink` 前调用 `assertNoStagedChanges(o.root)`。错误由现有 `PointersResult.status = 'failed'` 路径收集。

- [ ] **Step 4: 运行 pointer 测试**

Run: `npx vitest run tests/workspace/sync.test.ts -t "pointers|staged content"`

Expected: PASS；clean index 时仍恰好创建一个 pointer commit，dirty index 时不创建 commit 且保留原 staging。

- [ ] **Step 5: 提交**

```bash
git add src/git/workspace-ops.ts src/workspace/sync.ts tests/workspace/sync.test.ts
git commit -m "fix: isolate workspace pointer commits"
```

---

### Task 4: Publish 确认、CLI 接线与失败恢复

**Files:**
- Modify: `src/git/workspace-ops.ts`
- Modify: `src/workspace/publish.ts`
- Modify: `src/commands/workspace.ts`
- Modify: `src/cli.ts:139-152`
- Test: `tests/workspace/sync.test.ts`
- Create: `tests/workspace/publish-cli.test.ts`

**Interfaces:**
- Consumes: `prepareWorkspacePublish`、`executeWorkspacePublish`、`PublishPlan`、`assertNoStagedChanges`。
- Produces: `WorkspacePublishCliRuntime`，将 TTY、确认、stdout/stderr 和 exit code 注入 CLI 边界以便确定性测试。
- Produces: CLI option `--yes` 映射为 `WorkspacePublishCliOpts.yes?: boolean`。

- [ ] **Step 1: 写 publish 授权、事务恢复和 staged 隔离测试**

将既有 publish 成功 fixture 改为 `publish: true`，并通过 prepare/execute 调用。增加以下可观察契约：

```ts
it('rejects execution when the topic is not authorized', async () => {
  const { root } = makeLocalPublishFixture({ publish: false });
  const plan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' });
  await expect(executeWorkspacePublish(plan)).rejects.toMatchObject({ exitCode: 2 });
  expect(existsSync(join(root, '.gitmodules'))).toBe(false);
});

it('restores local state after push fails and can be retried', async () => {
  const { root, topic } = makeLocalPublishFixture({ publish: true });
  const remote = join(root, 'remote.git');
  const failedPlan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote });
  await expect(executeWorkspacePublish(failedPlan)).rejects.toThrow();
  expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic })).toThrow();
  expect(existsSync(join(root, '.gitmodules'))).toBe(false);

  execaSync('git', ['init', '--bare', '-b', 'main', remote]);
  await expect(executeWorkspacePublish(prepareWorkspacePublish({
    cwd: root,
    path: 'topic',
    remote,
  }))).resolves.toEqual(expect.objectContaining({ dryRun: false }));
});

it('refuses dirty index or dirty .gitmodules without changing either', async () => {
  const { root } = makeLocalPublishFixture({ publish: true });
  writeFileSync(join(root, 'unrelated'), 'staged');
  execaSync('git', ['add', 'unrelated'], { cwd: root });
  const plan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' });
  await expect(executeWorkspacePublish(plan)).rejects.toThrow(/staged changes/i);
  expect(execaSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.trim()).toBe(
    'unrelated',
  );
});
```

另加一个 `.gitmodules` 已 tracked 且有 unstaged 修改的 fixture，断言拒绝且文件字节不变。

- [ ] **Step 2: 写 CLI dry-run/确认测试**

创建 `tests/workspace/publish-cli.test.ts`，直接调用 `runWorkspacePublishCli` 并注入 runtime：

```ts
function fakeRuntime(o: { isTTY: boolean; confirmed?: boolean }) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  return {
    runtime: {
      isTTY: o.isTTY,
      confirm: async () => o.confirmed ?? false,
      writeOut: (text: string) => stdout.push(text),
      writeErr: (text: string) => stderr.push(text),
      setExitCode: (code: number) => { exitCode = code; },
    },
    stdout,
    stderr,
    getExitCode: () => exitCode,
  };
}

it('reports blocked dry-run without mutating an unauthorized topic', async () => {
  const io = fakeRuntime({ isTTY: false });
  await runWorkspacePublishCli('topic', {
    cwd: root,
    remote: 'https://token@example.com/o/t.git',
    dryRun: true,
  }, io.runtime);
  expect(io.getExitCode()).toBe(0);
  expect(io.stdout.join('')).toContain('blocked: publish not enabled');
  expect(io.stdout.join('')).not.toContain('token');
});

it('rejects non-interactive publish without --yes', async () => {
  const io = fakeRuntime({ isTTY: false });
  await runWorkspacePublishCli('topic', { cwd: root, remote }, io.runtime);
  expect(io.getExitCode()).toBe(2);
  expect(io.stderr.join('')).toMatch(/requires --yes/i);
});

it.each([
  { confirmed: false, expectedExit: 2 },
  { confirmed: true, expectedExit: 0 },
])('honors the TTY confirmation result', async ({ confirmed, expectedExit }) => {
  const io = fakeRuntime({ isTTY: true, confirmed });
  await runWorkspacePublishCli('topic', { cwd: root, remote }, io.runtime);
  expect(io.getExitCode()).toBe(expectedExit);
});
```

成功非交互用例传 `yes: true`。默认 runtime 使用 `readline/promises` 读取 `process.stdin`，提示 `[y/N]`；仅大小写不敏感的 `y`/`yes` 返回 true。

- [ ] **Step 3: 运行新增测试并确认失败**

Run: `npx vitest run tests/workspace/sync.test.ts tests/workspace/publish-cli.test.ts -t "publish|dirty index|requires --yes|blocked dry-run|TTY confirmation"`

Expected: FAIL；当前 CLI 无 `--yes`、无确认且 publish 失败残留 origin。

- [ ] **Step 4: 实现 publish 本地事务边界**

在 `src/git/workspace-ops.ts` 增加 `.gitmodules` 快照：

```ts
export interface GitmodulesSnapshot {
  existed: boolean;
  content?: Buffer;
}

export function snapshotGitmodules(root: string): GitmodulesSnapshot {
  const path = join(root, '.gitmodules');
  return existsSync(path)
    ? { existed: true, content: readFileSync(path) }
    : { existed: false };
}
```

执行前：

1. `assertNoStagedChanges(root)`；
2. `git diff --quiet -- .gitmodules`，非零且不是“文件不存在”时拒绝；
3. 保存 `.gitmodules` 快照；
4. `addOrigin`、`pushHead`、`registerExistingAsSubmodule`。

catch 中按顺序恢复：

```ts
await execa('git', ['reset', '--', '.gitmodules', plan.path], { cwd: plan.cwd });
restoreGitmodules(plan.cwd, snapshot);
await removeOriginIfMatches(plan.absPath, plan.remote);
throw err;
```

`removeOriginIfMatches` 必须先读取当前 origin；只有它仍等于本次 plan.remote 时才删除，避免移除并发写入的不同 remote。远端 push 不尝试删除。

- [ ] **Step 5: 实现 CLI 计划输出与确认**

`src/commands/workspace.ts` 的 publish 路径固定顺序：
```ts

export interface WorkspacePublishCliRuntime {
  isTTY: boolean;
  confirm(plan: PublishPlan): Promise<boolean>;
  writeOut(text: string): void;
  writeErr(text: string): void;
  setExitCode(code: number): void;
}

const plan = prepareWorkspacePublish({ cwd, path, remote: opts.remote });
runtime.writeOut(formatPublishPlan(plan));

if (opts.dryRun) {
  if (!plan.authorized) runtime.writeOut('blocked: publish not enabled\n');
  return;
}
if (!plan.authorized) throw new WorkspaceSyncError(`topic "${path}" is not enabled for publish`, 2);
if (!opts.yes && !runtime.isTTY) {
  throw new WorkspaceSyncError('non-interactive publish requires --yes', 2);
}
if (!opts.yes && !(await runtime.confirm(plan))) {
  throw new WorkspaceSyncError('publish cancelled', 2);
}
await executeWorkspacePublish(plan);
```

`formatPublishPlan` 只能使用 `plan.displayRemote`，显示 path、branch、短 HEAD、origin、`.gitmodules`、gitlink 和 super-repo commit；任何 catch 输出均先通过错误脱敏函数处理。`src/cli.ts` 注册：

```ts
.option('--yes', 'confirm non-interactive publish; does not bypass manifest permission')
```

并透传到 `runWorkspacePublishCli`；该函数第三个可选参数为 `runtime: WorkspacePublishCliRuntime = processPublishRuntime`，catch 分支通过 runtime 写 stderr 和设置 exit code。

- [ ] **Step 6: 运行 publish 和 CLI 测试**

Run: `npx vitest run tests/workspace/sync.test.ts tests/workspace/publish-cli.test.ts -t "publish|dirty index|requires --yes|blocked dry-run|TTY confirmation"`

Expected: PASS；失败 fixture 可重试，stdout/stderr 不含测试 token。

- [ ] **Step 7: 提交**

```bash
git add src/git/workspace-ops.ts src/workspace/publish.ts src/commands/workspace.ts src/cli.ts tests/workspace/sync.test.ts tests/workspace/publish-cli.test.ts
git commit -m "feat: gate and recover workspace publish"
```

---

### Task 5: 用户文档、完整回归与真实 CLI smoke test

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/design/130-workspace-sync.md`（仅当实现契约与已批准设计存在偏差；否则保持不动）

**Interfaces:**
- Consumes: 最终 CLI `workspace publish <path> --remote <url> [--yes] [--dry-run]`。
- Produces: 用户可复制的 manifest allowlist 与交互/CI 调用示例。

- [ ] **Step 1: 更新中英文 README**

中文示例必须包含：

```yaml
topics:
  - path: world-model
    active: true
    publish: true
```

以及：

```bash
# 人工 TTY：展示计划后确认
researcher workspace publish world-model --remote git@github.com:org/world-model.git

# CI/agent：仍须 manifest allowlist，并显式确认
researcher workspace publish world-model \
  --remote git@github.com:org/world-model.git \
  --yes
```

明确说明默认 `publish: false`、`--yes` 不能提权、dry-run 未授权只显示 blocked。英文 README 写同等语义，不增加额外行为。

- [ ] **Step 2: 运行静态检查和完整测试**

Run: `npx tsc --noEmit`

Expected: exit 0，无输出。

Run: `npx eslint src/cli.ts src/commands/workspace.ts src/git/workspace-ops.ts src/workspace/manifest.ts src/workspace/publish.ts src/workspace/remote-display.ts src/workspace/sync.ts src/workspace/topic-git.ts tests/workspace/sync.test.ts tests/workspace/publish-cli.test.ts`

Expected: exit 0，无输出。

Run: `npm test`
Expected: 所有非显式 skipped 测试通过；新增 publish policy、rollback、credential redaction、staged isolation 测试均在通过列表中。

- [ ] **Step 3: 构建并 smoke test 真实 CLI**

Run: `npm run build`

Expected: exit 0，生成 `dist/cli.js`。

在临时 super-repo + bare remote 上依次执行：

```bash
node dist/cli.js workspace publish topic --remote <bare> --dry-run --cwd <root>
node dist/cli.js workspace publish topic --remote <bare> --cwd <root>
node dist/cli.js workspace publish topic --remote <bare> --yes --cwd <root>
```

Expected:

1. 未授权 dry-run：exit 0，显示 `blocked: publish not enabled`，无 origin/`.gitmodules`/gitlink；
2. 授权但非 TTY 无 `--yes`：exit 2，零写入；
3. 授权且 `--yes`：exit 0，topic origin 指向 bare，bare 当前分支 tip 等于 topic HEAD，`.gitmodules` 恰好一个该 path 段，super-repo gitlink 等于 topic HEAD，自动 commit 不含无关文件。

- [ ] **Step 4: 提交文档和最终验证结果**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document workspace publish gate"
```

最终 PR 说明记录实际测试数字，不复制旧的 `534 passed`；以本次 `npm test` 输出为准。
