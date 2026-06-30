# landscape/notes 分区熵减 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 notes 引入 active/buffer/history 三区物理分区,每次 package 前由 rebalance 阶段按"机械复合分 + 软上限 + 滞回"自动重排,使焦点随领域演进而熵减。

**Architecture:** 新增 `rebalance` 阶段,置于 `read` 与 `synthesize` 之间。zone 存于每篇 note 的 YAML frontmatter(单一事实源),note 文件物理落在 `notes/{active,buffer,history}/`。rebalance 只做"算分 + `git mv` + 改 frontmatter",其后的 synthesize 重写 landscape/report/README 时顺手发出移动后的正确路径链接,故无需独立链接重写引擎。先实现完全确定性的机械骨架(Task 1–10),LLM 语义边界裁决作为最后一个可选/可推迟任务(Task 11)。

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod, vitest, execa, js-yaml。

## Global Constraints

- 全部 import 用 `.js` 后缀(ESM NodeNext)。
- 所有用户可见散文按 `project.yaml` 的 `meta.language` 输出(默认 `zh`);本期不改这条。
- **编号 `NN_` 即 note 身份:move 只改位置,绝不重编号。** `[N]` 引用按编号(去前导零)解析。
- `notes/00_research_landscape.md` 是索引,**留在 `notes/` 顶层,永不分区**。
- 不可变性开口子:rebalance 只允许"移动 + 改 frontmatter",**禁止改 note 正文**;synthesize 仍禁止编辑除 `00_` 外的 note 正文。
- frontmatter 缺省值:`zone: active`、`pin: false`、`score: 0`、`dwell: 0`(老 note 无 frontmatter 时按此解析,视同 active)。
- 测试用 vitest:`mkdtempSync` 建临时 repo、`git init -b main`、`runInit` + `runMethodologyInstall`,adapter 用实现 `AgentRuntime` 的 stub(见 `tests/pipeline/read.test.ts`)。
- 提交信息以 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 结尾。

---

## File Structure

- `src/state/zone.ts` (新) — note frontmatter 类型 + parse/serialize 纯函数。
- `src/state/note_index.ts` (新) — 跨 zone 子目录枚举 notes、算下一个编号。
- `src/pipeline/zoning.ts` (新) — 引用计数、打分、分区分配(含软上限 + 滞回)纯函数。
- `src/pipeline/rebalance.ts` (新) — rebalance 阶段编排。
- `prompts/stage-rebalance.md` (新) — LLM 边界裁决 prompt(Task 11)。
- `src/git/ops.ts` (改) — 加 `move`。
- `src/config/project-yaml.ts` (改) — 加 `zoning` schema。
- `src/state/runs.ts` (改) — `Stage` 加 `'rebalance'`。
- `src/pipeline/context.ts` (改) — 加 `newNoteRelPath?`、`zoneManifest?`。
- `src/pipeline/read.ts` (改) — 新 note 写入 `notes/active/`、带 frontmatter、跨目录编号。
- `src/pipeline/synthesize.ts` (改) — 注入 `zone_manifest` 模板变量。
- `src/pipeline/package.ts` (改) — 路径动态化 + move 感知的 snapshot/分支编排。
- `src/pipeline/package_feed.ts` (改) — 路径动态化 + move 感知提交。
- `src/commands/run.ts` (改) — 两条路径插入 rebalance 阶段。
- `prompts/stage-read.md` + `methodology/01-reading.md` (改) — 笔记模板纳入 frontmatter。
- `prompts/stage-synthesize.md` (改) — 按 zone 渲染、发出移动后路径。

---

## Task 1: `zoning` 配置 schema

**Files:**
- Modify: `src/config/project-yaml.ts`
- Test: `tests/config/project-yaml.test.ts`

**Interfaces:**
- Produces: `ProjectYaml.zoning: { active_max: number; buffer_max: number; min_dwell: number }`,缺省 `{12,30,2}`。

- [ ] **Step 1: 写失败测试**

在 `tests/config/project-yaml.test.ts` 追加:

```typescript
it('defaults zoning when omitted', () => {
  const p = writeYaml(`
meta: { language: zh }
research_questions: [{ id: q1, text: t }]
inclusion_criteria: [a]
exclusion_criteria: [b]
sources: [{ kind: arxiv, queries: [x] }]
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
`);
  const cfg = loadProjectYaml(p);
  expect(cfg.zoning).toEqual({ active_max: 12, buffer_max: 30, min_dwell: 2 });
});

it('accepts explicit zoning overrides', () => {
  const p = writeYaml(`
meta: { language: zh }
research_questions: [{ id: q1, text: t }]
inclusion_criteria: [a]
exclusion_criteria: [b]
sources: [{ kind: arxiv, queries: [x] }]
cadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }
zoning: { active_max: 5, buffer_max: 10, min_dwell: 1 }
`);
  expect(loadProjectYaml(p).zoning.active_max).toBe(5);
});
```

如果文件没有 `writeYaml` 帮手,用文件内既有的临时写法(参照现有用例写一个 `mkdtempSync` + `writeFileSync`)。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/config/project-yaml.test.ts`
Expected: FAIL（`cfg.zoning` 为 undefined）。

- [ ] **Step 3: 实现**

在 `src/config/project-yaml.ts` 的 `Cadence` 定义之后加:

```typescript
const Zoning = z
  .object({
    active_max: z.number().int().positive().default(12),
    buffer_max: z.number().int().positive().default(30),
    min_dwell: z.number().int().nonnegative().default(2),
  })
  .default({ active_max: 12, buffer_max: 30, min_dwell: 2 });
```

在 `ProjectYamlSchema` 里加一行 `zoning: Zoning,`（放在 `cadence` 后）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/config/project-yaml.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/config/project-yaml.ts tests/config/project-yaml.test.ts
git commit -m "feat(48): add zoning config to project.yaml schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: note frontmatter parse/serialize

**Files:**
- Create: `src/state/zone.ts`
- Test: `tests/state/zone.test.ts`

**Interfaces:**
- Produces:
  - `type Zone = 'active' | 'buffer' | 'history'`
  - `interface NoteFrontmatter { zone: Zone; pin: boolean; score: number; dwell: number }`
  - `const DEFAULT_FM: NoteFrontmatter`
  - `function parseNote(content: string): { fm: NoteFrontmatter; body: string }`
  - `function serializeNote(fm: NoteFrontmatter, body: string): string`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { parseNote, serializeNote, DEFAULT_FM } from '../../src/state/zone.js';

describe('note frontmatter', () => {
  it('treats a legacy note without frontmatter as active/unpinned', () => {
    const { fm, body } = parseNote('# Title\n\n## Claims\n- x');
    expect(fm).toEqual(DEFAULT_FM);
    expect(body).toBe('# Title\n\n## Claims\n- x');
  });

  it('parses an existing frontmatter block', () => {
    const src = '---\nzone: history\npin: true\nscore: 0.4\ndwell: 3\n---\n# T\n\nbody';
    const { fm, body } = parseNote(src);
    expect(fm).toEqual({ zone: 'history', pin: true, score: 0.4, dwell: 3 });
    expect(body).toBe('# T\n\nbody');
  });

  it('round-trips serialize(parse(x))', () => {
    const src = '---\nzone: buffer\npin: false\nscore: 0\ndwell: 1\n---\n# T\n\nbody\n';
    const { fm, body } = parseNote(src);
    const out = serializeNote(fm, body);
    expect(parseNote(out).fm).toEqual(fm);
    expect(parseNote(out).body).toBe(body);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/state/zone.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/state/zone.ts`：

```typescript
import { load as parseYaml } from 'js-yaml';

export type Zone = 'active' | 'buffer' | 'history';

export interface NoteFrontmatter {
  zone: Zone;
  pin: boolean;
  score: number;
  dwell: number;
}

export const DEFAULT_FM: NoteFrontmatter = { zone: 'active', pin: false, score: 0, dwell: 0 };

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseNote(content: string): { fm: NoteFrontmatter; body: string } {
  const m = FM_RE.exec(content);
  if (!m) return { fm: { ...DEFAULT_FM }, body: content };
  const raw = (parseYaml(m[1]) ?? {}) as Record<string, unknown>;
  const zone = raw.zone === 'buffer' || raw.zone === 'history' ? raw.zone : 'active';
  const fm: NoteFrontmatter = {
    zone,
    pin: raw.pin === true,
    score: typeof raw.score === 'number' ? raw.score : 0,
    dwell: typeof raw.dwell === 'number' ? raw.dwell : 0,
  };
  return { fm, body: content.slice(m[0].length) };
}

export function serializeNote(fm: NoteFrontmatter, body: string): string {
  const head =
    `---\n` +
    `zone: ${fm.zone}\n` +
    `pin: ${fm.pin}\n` +
    `score: ${fm.score}\n` +
    `dwell: ${fm.dwell}\n` +
    `---\n`;
  return head + body;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/state/zone.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/state/zone.ts tests/state/zone.test.ts
git commit -m "feat(48): note frontmatter parse/serialize for zoning

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 跨 zone 子目录枚举 notes

**Files:**
- Create: `src/state/note_index.ts`
- Test: `tests/state/note_index.test.ts`

**Interfaces:**
- Consumes: `parseNote`, `Zone`, `NoteFrontmatter` from `./zone.js`。
- Produces:
  - `interface NoteEntry { num: number; filename: string; zone: Zone; relPath: string; absPath: string; fm: NoteFrontmatter }`
  - `function listNotes(projectRoot: string): NoteEntry[]`（跨 `notes/{active,buffer,history}/NN_*.md` + 兼容遗留 `notes/NN_*.md`，排除 `00_`；遗留无目录的 `zone` 取其 frontmatter，缺省 active；`relPath` 是相对 `projectRoot` 的 `notes/<zone>/<file>` 或遗留 `notes/<file>`）
  - `function nextNoteNumber(projectRoot: string): number`（= 最大 num + 1，空库返回 1）

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listNotes, nextNoteNumber } from '../../src/state/note_index.js';

describe('note_index', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-idx-'));
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    mkdirSync(join(proj, 'notes/history'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# landscape');
    writeFileSync(join(proj, 'notes/active/07_foo.md'), '---\nzone: active\npin: false\nscore: 0\ndwell: 0\n---\n# foo');
    writeFileSync(join(proj, 'notes/history/01_baz.md'), '---\nzone: history\npin: true\nscore: 0\ndwell: 5\n---\n# baz');
    writeFileSync(join(proj, 'notes/03_legacy.md'), '# legacy no fm'); // 遗留平铺
  });

  it('enumerates notes across zones + legacy, excluding 00_', () => {
    const got = listNotes(proj).sort((a, b) => a.num - b.num);
    expect(got.map((n) => [n.num, n.zone, n.relPath])).toEqual([
      [1, 'history', 'notes/history/01_baz.md'],
      [3, 'active', 'notes/03_legacy.md'],
      [7, 'active', 'notes/active/07_foo.md'],
    ]);
    expect(got.find((n) => n.num === 1)!.fm.pin).toBe(true);
  });

  it('nextNoteNumber is max+1', () => {
    expect(nextNoteNumber(proj)).toBe(8);
  });

  it('nextNoteNumber is 1 on an empty/missing notes dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'r-idx-empty-'));
    expect(nextNoteNumber(empty)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/state/note_index.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/state/note_index.ts`：

```typescript
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNote, type NoteFrontmatter, type Zone } from './zone.js';

export interface NoteEntry {
  num: number;
  filename: string;
  zone: Zone;
  relPath: string;
  absPath: string;
  fm: NoteFrontmatter;
}

const ZONES: Zone[] = ['active', 'buffer', 'history'];
const NOTE_RE = /^(\d+)_.*\.md$/;

export function listNotes(projectRoot: string): NoteEntry[] {
  const notesDir = join(projectRoot, 'notes');
  const out: NoteEntry[] = [];
  const collect = (dirRel: string) => {
    const abs = join(projectRoot, dirRel);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs)) {
      const m = NOTE_RE.exec(f);
      if (!m || f.startsWith('00_')) continue;
      const relPath = `${dirRel}/${f}`;
      const absPath = join(projectRoot, relPath);
      const { fm } = parseNote(readFileSync(absPath, 'utf8'));
      out.push({ num: parseInt(m[1], 10), filename: f, zone: fm.zone, relPath, absPath, fm });
    }
  };
  if (existsSync(notesDir)) collect('notes'); // legacy flat
  for (const z of ZONES) collect(`notes/${z}`);
  return out;
}

export function nextNoteNumber(projectRoot: string): number {
  const max = listNotes(projectRoot).reduce((m, n) => (n.num > m ? n.num : m), 0);
  return max + 1;
}
```

注意:遗留平铺文件的 `zone` 由其 frontmatter 决定;测试里 `notes/03_legacy.md` 无 frontmatter → 默认 active,符合断言。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/state/note_index.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/state/note_index.ts tests/state/note_index.test.ts
git commit -m "feat(48): zone-aware note index + next-number across subdirs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 打分 + 分区分配纯函数

**Files:**
- Create: `src/pipeline/zoning.ts`
- Test: `tests/pipeline/zoning.test.ts`

**Interfaces:**
- Consumes: `NoteEntry` from `../state/note_index.js`, `Zone` from `../state/zone.js`。
- Produces:
  - `function countCitations(num: number, corpus: string): number`
  - `function scoreNote(heat: number, num: number, maxHeat: number, maxNum: number): number`
  - `interface Assignment { num: number; from: Zone; to: Zone; moved: boolean }`
  - `function assignZones(notes: NoteEntry[], scores: Map<number, number>, cfg: { active_max: number; buffer_max: number; min_dwell: number }): Assignment[]`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { countCitations, scoreNote, assignZones } from '../../src/pipeline/zoning.js';
import type { NoteEntry } from '../../src/state/note_index.js';
import type { Zone } from '../../src/state/zone.js';

function note(num: number, zone: Zone, dwell: number, pin = false): NoteEntry {
  return {
    num, filename: `${num}_x.md`, zone,
    relPath: `notes/${zone}/${num}_x.md`, absPath: '/x',
    fm: { zone, pin, score: 0, dwell },
  };
}

describe('countCitations', () => {
  it('counts [N], [N, ..], [N: ..] but not [NN] superstrings', () => {
    const corpus = 'see [1] and [1: §2] and [1, 3] and [12] and [21]';
    expect(countCitations(1, corpus)).toBe(3);
    expect(countCitations(12, corpus)).toBe(1);
  });
});

describe('assignZones', () => {
  const cfg = { active_max: 2, buffer_max: 2, min_dwell: 2 };

  it('fills active then buffer then history by score desc', () => {
    const notes = [note(1,'active',5), note(2,'active',5), note(3,'active',5), note(4,'active',5), note(5,'active',5)];
    const scores = new Map([[1,0.9],[2,0.8],[3,0.7],[4,0.6],[5,0.5]]);
    const a = assignZones(notes, scores, cfg);
    const to = (n: number) => a.find((x) => x.num === n)!.to;
    expect([to(1),to(2)]).toEqual(['active','active']);
    expect([to(3),to(4)]).toEqual(['buffer','buffer']);
    expect(to(5)).toBe('history');
  });

  it('respects hysteresis: a note below min_dwell does not move', () => {
    const notes = [note(1,'active',0), note(2,'active',5), note(3,'active',5)]; // note1 just arrived
    const scores = new Map([[1,0.1],[2,0.9],[3,0.8]]); // note1 should drop to buffer by score
    const a = assignZones(notes, scores, { active_max: 2, buffer_max: 2, min_dwell: 2 });
    expect(a.find((x) => x.num === 1)!.moved).toBe(false); // dwell 0 < 2 → stays
    expect(a.find((x) => x.num === 1)!.to).toBe('active');
  });

  it('never moves a pinned note', () => {
    const notes = [note(1,'history',9,true), note(2,'active',9), note(3,'active',9)];
    const scores = new Map([[1,0.99],[2,0.5],[3,0.4]]);
    const a = assignZones(notes, scores, { active_max: 2, buffer_max: 2, min_dwell: 0 });
    const e1 = a.find((x) => x.num === 1)!;
    expect(e1.moved).toBe(false);
    expect(e1.to).toBe('history');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/pipeline/zoning.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/pipeline/zoning.ts`：

```typescript
import type { NoteEntry } from '../state/note_index.js';
import type { Zone } from '../state/zone.js';

/** Count [N] citations of note `num` across a corpus. Matches [N], [N:..], [N,..]
 *  but not a longer number ([12] is not a hit for 1). */
export function countCitations(num: number, corpus: string): number {
  const re = new RegExp(`\\[\\s*${num}(?=[\\],:\\s])`, 'g');
  return (corpus.match(re) ?? []).length;
}

/** Composite score in [0,1]: 60% citation heat, 40% recency (higher note number = newer). */
export function scoreNote(heat: number, num: number, maxHeat: number, maxNum: number): number {
  const h = maxHeat > 0 ? heat / maxHeat : 0;
  const r = maxNum > 0 ? num / maxNum : 0;
  return 0.6 * h + 0.4 * r;
}

export interface Assignment {
  num: number;
  from: Zone;
  to: Zone;
  moved: boolean;
}

export function assignZones(
  notes: NoteEntry[],
  scores: Map<number, number>,
  cfg: { active_max: number; buffer_max: number; min_dwell: number },
): Assignment[] {
  const pinnedActive = notes.filter((n) => n.fm.pin && n.fm.zone === 'active').length;
  const pinnedBuffer = notes.filter((n) => n.fm.pin && n.fm.zone === 'buffer').length;
  const activeSlots = Math.max(0, cfg.active_max - pinnedActive);
  const bufferSlots = Math.max(0, cfg.buffer_max - pinnedBuffer);

  const unpinned = notes
    .filter((n) => !n.fm.pin)
    .sort((a, b) => {
      const d = (scores.get(b.num) ?? 0) - (scores.get(a.num) ?? 0);
      return d !== 0 ? d : b.num - a.num; // tie: newer first
    });

  const target = new Map<number, Zone>();
  unpinned.forEach((n, i) => {
    const t: Zone = i < activeSlots ? 'active' : i < activeSlots + bufferSlots ? 'buffer' : 'history';
    target.set(n.num, t);
  });

  return notes.map((n) => {
    const from = n.fm.zone;
    const to = n.fm.pin ? from : target.get(n.num)!;
    const moved = !n.fm.pin && to !== from && n.fm.dwell >= cfg.min_dwell;
    return { num: n.num, from, to: moved ? to : from, moved };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/pipeline/zoning.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/zoning.ts tests/pipeline/zoning.test.ts
git commit -m "feat(48): citation-heat + recency scoring and capped zone assignment

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `git mv` op

**Files:**
- Modify: `src/git/ops.ts`
- Test: `tests/git/ops.test.ts`（无则新建）

**Interfaces:**
- Produces: `function move(o: { cwd: string; from: string; to: string }): Promise<void>`（相对路径,from/to 都相对 cwd；自动建目标父目录）。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { move } from '../../src/git/ops.js';

describe('git move', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-mv-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    writeFileSync(join(proj, 'notes/active/07_x.md'), 'body');
    execaSync('git', ['add', '-A'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('moves a tracked file into a new subdir', async () => {
    await move({ cwd: proj, from: 'notes/active/07_x.md', to: 'notes/history/07_x.md' });
    expect(existsSync(join(proj, 'notes/active/07_x.md'))).toBe(false);
    expect(existsSync(join(proj, 'notes/history/07_x.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/git/ops.test.ts`
Expected: FAIL（`move` 未导出）。

- [ ] **Step 3: 实现**

在 `src/git/ops.ts` 顶部加 `import { mkdirSync } from 'node:fs';` 和 `import { dirname, join } from 'node:path';`，并追加:

```typescript
/** git mv a tracked file, creating the destination's parent dir first. */
export async function move(o: { cwd: string; from: string; to: string }): Promise<void> {
  mkdirSync(dirname(join(o.cwd, o.to)), { recursive: true });
  await execa('git', ['mv', o.from, o.to], { cwd: o.cwd });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/git/ops.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/git/ops.ts tests/git/ops.test.ts
git commit -m "feat(48): add git move op for zone relocation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `Stage` 与 `RunContext` 扩字段

**Files:**
- Modify: `src/state/runs.ts:5-13`
- Modify: `src/pipeline/context.ts:33-37`
- Test: 类型层改动,无独立单测;由 `npx tsc --noEmit` + 后续任务覆盖。

**Interfaces:**
- Produces: `Stage` 新增成员 `'rebalance'`;`RunContext` 新增 `newNoteRelPath?: string`、`zoneManifest?: string`。

- [ ] **Step 1: 改 `Stage`**

`src/state/runs.ts` 的 union 增加一行（放在 `'read'` 之后）：

```typescript
  | 'rebalance'
```

- [ ] **Step 2: 改 `RunContext`**

`src/pipeline/context.ts` 在 `// carries` 块内追加:

```typescript
  /** Relative path of the note written this run, including its zone subdir (e.g. notes/active/07_x.md). */
  newNoteRelPath?: string;
  /** Newline list "NN zone" for every note, injected into the synthesize prompt so it
   *  demotes history-zone papers to landscape archive / report appendix. */
  zoneManifest?: string;
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS（无新错误；既有 `newNoteFilename` 仍在）。

- [ ] **Step 4: 提交**

```bash
git add src/state/runs.ts src/pipeline/context.ts
git commit -m "feat(48): add rebalance stage + zone carries to context

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `read` 阶段写入 `notes/active/` 并带 frontmatter

**Files:**
- Modify: `src/pipeline/read.ts:29-72`
- Modify: `prompts/stage-read.md`（把 `next_note_filename` 语义改为相对路径 + 要求输出 frontmatter）
- Modify: `methodology/01-reading.md`（模板顶部加 frontmatter 约定）
- Test: `tests/pipeline/read.test.ts`

**Interfaces:**
- Consumes: `nextNoteNumber` from `../state/note_index.js`, `serializeNote`/`parseNote`/`DEFAULT_FM` from `../state/zone.js`。
- Produces: 设 `ctx.newNoteFilename`（纯文件名,不含目录,后续编号/命名逻辑不变）与 `ctx.newNoteRelPath = 'notes/active/<filename>'`。新 note 落地后保证含 frontmatter（`zone: active`）。

- [ ] **Step 1: 改测试以反映新落点**

把 `tests/pipeline/read.test.ts` 里 stub 写文件的位置从 `notes/01_*.md` 改为 `notes/active/01_*.md`，并新增断言。改 `StubAdapter`：

```typescript
class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const noteContent = '# Stub note\n\n## Claims\n- something';
    writeFileSync(join(opts.cwd, 'notes', 'active', '01_stub_paper.md'), noteContent);
    return { output: 'done\n\nFILES_MODIFIED:\nnotes/active/01_stub_paper.md\n', modifiedFiles: ['notes/active/01_stub_paper.md'], exitCode: 0 };
  }
}
```

把 `beforeEach` 里 `mkdirSync(join(proj, 'notes'))` 改为 `mkdirSync(join(proj, 'notes', 'active'), { recursive: true })`。其余 stub（FreshStub、Capturing*）同样把写入路径改到 `notes/active/`，FreshStub 内 `mkdirSync(join(opts.cwd,'notes','active'),{recursive:true})`。

在首个用例追加:

```typescript
expect(ctx.newNoteRelPath).toBe('notes/active/01_stub_paper.md');
```

新增用例:

```typescript
it('ensures the new note carries zone frontmatter (active)', async () => {
  const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
  const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
  await read(ctx);
  const txt = readFileSync(join(proj, ctx.newNoteRelPath!), 'utf8');
  expect(txt.startsWith('---\nzone: active\n')).toBe(true);
});
```

（在文件顶部 import 里补 `readFileSync`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/pipeline/read.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `read.ts`**

替换 `read.ts` 中编号与落点逻辑（约 29–43 行与 69–72 行）：

```typescript
import { nextNoteNumber, listNotes } from '../state/note_index.js';
import { parseNote, serializeNote, DEFAULT_FM } from '../state/zone.js';
// ... 既有 import 保留
```

把:

```typescript
  const notesDir = join(ctx.projectRoot, 'notes');
  const existing = existsSync(notesDir) ? ... ;
  const maxNum = existing.reduce(...);
  const nextNum = (maxNum + 1).toString().padStart(2, '0');
  const slug = slugify(material.slugSeed);
  const nextFilename = `${nextNum}_${slug}.md`;
```

改为:

```typescript
  const activeDir = join(ctx.projectRoot, 'notes', 'active');
  mkdirSync(activeDir, { recursive: true });
  const nextNum = nextNoteNumber(ctx.projectRoot).toString().padStart(2, '0');
  const slug = slugify(material.slugSeed);
  const nextFilename = `${nextNum}_${slug}.md`;
  const relPath = `notes/active/${nextFilename}`;
  // 把已有 notes 列表喂给 prompt，保留原 notes_dir_listing 语义
  const existing = listNotes(ctx.projectRoot).map((n) => n.relPath).sort();
```

在顶部 import 补 `mkdirSync`（来自 `node:fs`，已 import `existsSync` 等，追加即可）。

`renderTemplate` 的 `next_note_filename` 改成传 `relPath`：

```typescript
    notes_dir_listing: existing.join('\n'),
    next_note_filename: relPath,
```

落点读取与 frontmatter 兜底（替换末尾 69–72 行）：

```typescript
  const fullPath = join(ctx.projectRoot, relPath);
  // 兜底:若 agent 没写 frontmatter,补一个默认 active 头,保证下游 listNotes 一致。
  const written = readFileSync(fullPath, 'utf8');
  const { fm, body } = parseNote(written);
  if (!written.startsWith('---\n')) writeFileSync(fullPath, serializeNote({ ...DEFAULT_FM }, body));
  ctx.newNoteFilename = nextFilename;
  ctx.newNoteRelPath = relPath;
  ctx.newNoteContent = readFileSync(fullPath, 'utf8');
  void fm;
```

- [ ] **Step 4: 改 prompt + methodology**

`prompts/stage-read.md`：把"写到 `notes/{{next_note_filename}}`"等措辞改为"写到 `{{next_note_filename}}`（已含 `notes/active/` 前缀）"，并在输出要求里加一句:

> 笔记**第一行起**必须是 YAML frontmatter:`---\nzone: active\npin: false\nscore: 0\ndwell: 0\n---`,紧接 H1 标题与 Frame 引用块。frontmatter 之外的正文结构不变。

`methodology/01-reading.md`：在"Reading template (mandatory)"小节顶部加一段:

> 每篇 note 以最小 YAML frontmatter 起头(`zone`/`pin`/`score`/`dwell`),由系统维护分区;人可手动设 `pin: true` 钉住不被归档。frontmatter 在 H1 之上,不参与按 `## ` 标题的综合扫描。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/pipeline/read.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/pipeline/read.ts prompts/stage-read.md methodology/01-reading.md tests/pipeline/read.test.ts
git commit -m "feat(48): read writes notes into notes/active with zone frontmatter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `rebalance` 阶段(机械路径)

**Files:**
- Create: `src/pipeline/rebalance.ts`
- Test: `tests/pipeline/rebalance.test.ts`

**Interfaces:**
- Consumes: `listNotes` (`../state/note_index.js`), `countCitations`/`scoreNote`/`assignZones` (`./zoning.js`), `parseNote`/`serializeNote` (`../state/zone.js`), `gitops.move` (`../git/ops.js`), `RunContext`。
- Produces: `function rebalance(ctx: RunContext): Promise<void>` —— 对每篇 note 重算 score、写回 frontmatter（score/dwell）、对 `moved` 的 `git mv` 并改 frontmatter.zone；写 `rebalance-summary.md` 到 run dir；设 `ctx.zoneManifest`。**本任务不调 LLM**（边界裁决在 Task 11 接入,缺省走纯机械）。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { rebalance } from '../../src/pipeline/rebalance.js';
import { parseNote } from '../../src/state/zone.js';
import { RunDir, newRunId } from '../../src/state/runs.js';

function noteFile(zone: string, num: string, slug: string, dwell = 9, pin = false) {
  return {
    rel: `notes/${zone}/${num}_${slug}.md`,
    body: `---\nzone: ${zone}\npin: ${pin}\nscore: 0\ndwell: ${dwell}\n---\n# ${slug}\n\n## Claims\n- x`,
  };
}

function makeCtx(proj: string, cfg = { active_max: 2, buffer_max: 2, min_dwell: 0 }) {
  const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
  return {
    projectRoot: proj,
    researcherDir: join(proj, '.researcher'),
    projectYaml: { zoning: cfg } as any,
    runDir: rd,
  } as any;
}

describe('rebalance', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-reb-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    // 5 active notes, no citations → recency (num) decides; lowest nums sink.
    for (const n of ['01','02','03','04','05']) {
      const f = noteFile('active', n, 'p' + n);
      mkdirSync(join(proj, 'notes/active'), { recursive: true });
      writeFileSync(join(proj, f.rel), f.body);
    }
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# landscape');
    execaSync('git', ['add', '-A'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('demotes lowest-scored notes past active/buffer caps and moves the files', async () => {
    const ctx = makeCtx(proj);
    await rebalance(ctx);
    // active_max=2,buffer_max=2 → 05,04 active;03,02 buffer;01 history
    expect(existsSync(join(proj, 'notes/active/05_p05.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/buffer/03_p03.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/history/01_p01.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/active/01_p01.md'))).toBe(false);
    // frontmatter zone updated
    expect(parseNote(readFileSync(join(proj, 'notes/history/01_p01.md'), 'utf8')).fm.zone).toBe('history');
    // summary + manifest
    expect(existsSync(ctx.runDir.path('rebalance-summary.md'))).toBe(true);
    expect(ctx.zoneManifest).toContain('05 active');
    expect(ctx.zoneManifest).toContain('01 history');
  });

  it('honors min_dwell hysteresis (no move when dwell below threshold)', async () => {
    // bump min_dwell above every note's dwell → nothing moves
    const ctx = makeCtx(proj, { active_max: 2, buffer_max: 2, min_dwell: 99 });
    await rebalance(ctx);
    expect(existsSync(join(proj, 'notes/active/01_p01.md'))).toBe(true); // stayed
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/pipeline/rebalance.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/pipeline/rebalance.ts`：

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listNotes } from '../state/note_index.js';
import { parseNote, serializeNote } from '../state/zone.js';
import { countCitations, scoreNote, assignZones } from './zoning.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';

/** Build the citation corpus: landscape + report + README + every note body. */
function buildCorpus(projectRoot: string, noteAbsPaths: string[]): string {
  const parts: string[] = [];
  for (const rel of ['notes/00_research_landscape.md', 'report.md', 'README.md']) {
    const abs = join(projectRoot, rel);
    if (existsSync(abs)) parts.push(readFileSync(abs, 'utf8'));
  }
  for (const abs of noteAbsPaths) parts.push(readFileSync(abs, 'utf8'));
  return parts.join('\n');
}

export async function rebalance(ctx: RunContext): Promise<void> {
  const notes = listNotes(ctx.projectRoot);
  if (notes.length === 0) {
    ctx.zoneManifest = '(no notes yet)';
    return;
  }
  const cfg = ctx.projectYaml.zoning;
  const corpus = buildCorpus(ctx.projectRoot, notes.map((n) => n.absPath));

  const heat = new Map<number, number>();
  for (const n of notes) heat.set(n.num, countCitations(n.num, corpus));
  const maxHeat = Math.max(0, ...heat.values());
  const maxNum = Math.max(...notes.map((n) => n.num));
  const scores = new Map<number, number>();
  for (const n of notes) scores.set(n.num, scoreNote(heat.get(n.num)!, n.num, maxHeat, maxNum));

  const assignments = assignZones(notes, scores, cfg);
  const byNum = new Map(notes.map((n) => [n.num, n]));

  const summary: string[] = ['# Rebalance summary', ''];
  for (const a of assignments) {
    const n = byNum.get(a.num)!;
    const newScore = scores.get(a.num)!;
    if (a.moved) {
      const toRel = `notes/${a.to}/${n.filename}`;
      await gitops.move({ cwd: ctx.projectRoot, from: n.relPath, to: toRel });
      const { body } = parseNote(readFileSync(join(ctx.projectRoot, toRel), 'utf8'));
      writeFileSync(join(ctx.projectRoot, toRel), serializeNote(
        { zone: a.to, pin: n.fm.pin, score: newScore, dwell: 0 }, body,
      ));
      summary.push(`- [${a.num}] ${n.filename}: ${a.from} → ${a.to} (score ${newScore.toFixed(3)})`);
      n.zone = a.to; // reflect for manifest
    } else {
      // stayed: bump dwell (unpinned), refresh score, rewrite in place
      const { body } = parseNote(readFileSync(n.absPath, 'utf8'));
      const dwell = n.fm.pin ? n.fm.dwell : n.fm.dwell + 1;
      writeFileSync(n.absPath, serializeNote(
        { zone: n.fm.zone, pin: n.fm.pin, score: newScore, dwell }, body,
      ));
    }
  }

  const summaryPath = ctx.runDir.path('rebalance-summary.md');
  mkdirSync(ctx.runDir.dir, { recursive: true });
  const moves = assignments.filter((a) => a.moved).length;
  if (moves === 0) summary.push('(no zone changes this run)');
  writeFileSync(summaryPath, summary.join('\n') + '\n');

  ctx.zoneManifest = notes
    .slice()
    .sort((a, b) => a.num - b.num)
    .map((n) => `${String(n.num).padStart(2, '0')} ${n.zone}`)
    .join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/pipeline/rebalance.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/rebalance.ts tests/pipeline/rebalance.test.ts
git commit -m "feat(48): mechanical rebalance stage (score + caps + hysteresis + git mv)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 把 rebalance 接入两条流水线

**Files:**
- Modify: `src/commands/run.ts:96-147`
- Test: `tests/commands/run.test.ts` 和 `tests/commands/run_feed.test.ts`

**Interfaces:**
- Consumes: `rebalance` from `../pipeline/rebalance.js`。
- Produces: paper 路径 plan = `['bootstrap','soul','discover','read','rebalance','synthesize','package']`;feed 路径在 `feed-synthesize` 之前插入 `rebalance`。

- [ ] **Step 1: 写失败测试**

在 `tests/commands/run.test.ts` 找到断言 `emitEvent` plan 的用例（或捕获 stdout/事件的用例），加断言计划包含 `'rebalance'` 且位于 `read` 与 `synthesize` 之间。若现有测试用 `events` 收集器:

```typescript
const plan = events.find((e) => e.type === 'plan');
expect(plan.stages).toEqual(['bootstrap','soul','discover','read','rebalance','synthesize','package']);
```

若 run.test.ts 没有现成 plan 捕获,改为断言一次完整 run 后 `notes/active/` 下存在该论文(证明 rebalance 没破坏流程),并在 run_feed.test.ts 同理加 `rebalance` 进 feed plan 的断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/commands/run.test.ts tests/commands/run_feed.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/commands/run.ts` 顶部 import:

```typescript
import { rebalance } from '../pipeline/rebalance.js';
```

paper 路径(约 129–147 行):把 plan 事件与 stage 列表改为含 rebalance。

```typescript
    emitEvent({
      type: 'plan',
      stages: ['bootstrap', 'soul', 'discover', 'read', 'rebalance', 'synthesize', 'package'],
    });
```

并在 `read` 与 `synthesize` 之间插入:

```typescript
    await runStages(runDir, [
      { name: 'read',       fn: async () => read(ctx!) },
      { name: 'rebalance',  fn: async () => rebalance(ctx!) },
      { name: 'synthesize', fn: async () => synthesize(ctx!) },
      { name: 'package',    fn: async () => packageStage(ctx!) },
    ]);
```

feed 路径(约 98–108 行):在 `feed-synthesize` 之前加 rebalance,并把 plan 列表同步。

```typescript
      const feedStages: StageDef[] = [
        { name: 'rebalance', fn: async () => rebalance(ctx!) },
        { name: 'feed-synthesize', fn: async () => feedSynthesize(ctx!) },
      ];
```

`emitEvent({ type: 'plan', stages: ['bootstrap', 'soul', ...feedStages.map((s) => s.name)] });` 这行已按 feedStages 派生,自动包含 rebalance,无需再改。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/commands/run.test.ts tests/commands/run_feed.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/commands/run.ts tests/commands/run.test.ts tests/commands/run_feed.test.ts
git commit -m "feat(48): wire rebalance into paper + feed pipelines (before synthesize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: synthesize/package 路径与 zone 感知

**Files:**
- Modify: `src/pipeline/synthesize.ts:40-58`
- Modify: `prompts/stage-synthesize.md`
- Modify: `src/pipeline/package.ts:30-37, 88-97, 158-163`
- Modify: `src/pipeline/package_feed.ts:50-66`
- Test: `tests/pipeline/synthesize.test.ts`（无则新建）、`tests/commands/run.test.ts`（端到端 move 持久化）

**Interfaces:**
- Consumes: `ctx.zoneManifest`、`ctx.newNoteRelPath`、`listNotes`。
- Produces: synthesize prompt 含 `{{zone_manifest}}`;package 的 dirty 白名单、snapshot、commit 路径由 `listNotes` 动态派生并感知 move（删旧路径+建新路径）。

- [ ] **Step 1: synthesize 注入 manifest（先写测试)**

在 `tests/pipeline/synthesize.test.ts`（参照 read.test.ts 的 stub 风格）断言:`zone_manifest` 被渲染进 prompt。用 CapturingAdapter 抓 `lastPrompt`，预置一篇 `notes/history/01_x.md`，断言 `lastPrompt` 含 `01 history`。

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run tests/pipeline/synthesize.test.ts` → FAIL。

- [ ] **Step 3: 实现 synthesize 注入**

`src/pipeline/synthesize.ts`：import `listNotes`，在 `renderTemplate` 前构造 manifest（若 `ctx.zoneManifest` 已由 rebalance 设好则直接用,否则现算）：

```typescript
import { listNotes } from '../state/note_index.js';
// ...
  const zoneManifest = ctx.zoneManifest ?? listNotes(ctx.projectRoot)
    .sort((a, b) => a.num - b.num)
    .map((n) => `${String(n.num).padStart(2, '0')} ${n.zone}`)
    .join('\n');
```

在 `renderTemplate` 的 vars 里加 `zone_manifest: zoneManifest || '(no notes)'`。

`prompts/stage-synthesize.md`：在"New note to integrate"之前插一节:

```markdown
## 论文分区清单(zone manifest)

下表是每篇笔记当前所在分区(由 rebalance 阶段维护):

{{zone_manifest}}

渲染规则:
- `active` 论文:report 主线分析、landscape 重点位、完整 bullet。
- `buffer` 论文:轻量提及,不占主线篇幅。
- `history` 论文:landscape 归入"归档"子列表(单行),report 归入 `## 附录: Superseded works` 同区的"历史"段(单行);不在主线展开。
- 这些笔记文件已被物理移动到 `notes/<zone>/`,你写入 landscape/report/README 的所有指向笔记的**路径型链接**必须使用移动后的 `notes/<zone>/NN_<slug>.md`。`[N]` 编号引用不变。
```

并在该 prompt 末尾的"What you MUST NOT change"附近补一句:history 论文从主线降级属于**预期的分区渲染**,不算违规重写。

- [ ] **Step 4: 跑 synthesize 测试确认通过** — `npx vitest run tests/pipeline/synthesize.test.ts` → PASS。

- [ ] **Step 5: package 路径动态化 + move 感知(先写端到端测试)**

在 `tests/commands/run.test.ts` 新增/扩展一个用例:构造一个 stub 序列,使 rebalance 把某老 note 从 active 移到 history,断言 package 后(在产生的 researcher 分支工作树上)该 note 在 `notes/history/` 存在、`notes/active/` 不存在,且 `[N]` 引用仍可在 report 中找到。利用既有 run.test 的 adapter 序列模式（按 stage 切换行为的 stub）。

- [ ] **Step 6: 跑测试确认失败** — FAIL。

- [ ] **Step 7: 实现 package 动态路径**

`src/pipeline/package.ts`：import `listNotes`。

(a) dirty 白名单(约 30–37 行):把固定的 `notes/${ctx.newNoteFilename}` 改为允许整个 `notes/` 子树（rebalance 会动多篇）:

```typescript
    allowedPrefixes: [
      '.researcher/', 'README.md', 'report.md', 'papers/', 'references/',
      'notes/',
    ],
```

（`notes/` 覆盖 landscape、各 zone 子目录与移动产生的增删；其余目录仍受保护。）

(b) snapshot 集合(约 88–101 行):候选路径里 `join('notes', newNoteFilename)` 换成"当前所有 note 的 relPath + landscape"，并记录**当前 notes 全集**用于分支后清理旧路径:

```typescript
  const noteRelPaths = listNotes(ctx.projectRoot).map((n) => n.relPath);
  const candidatePaths = [
    ...noteRelPaths,
    LANDSCAPE,
    'README.md',
    'report.md',
    'papers/README.md',
    '.researcher/project.yaml',
    '.researcher/thesis.md',
    '.researcher/.gitignore',
  ];
```

(c) 分支后 restore(约 124–129 行之后)：现有逻辑把 snapshot 内容写回各自 relPath。补一步:**删除 main 树上存在、但不在本次 snapshot 集合里的 note 文件**(即被 move 走的旧路径)：

```typescript
  // remove note files that exist on main's tree but were relocated this run
  for (const stale of listNotes(ctx.projectRoot).map((n) => n.relPath)) {
    if (!snapshots.has(stale)) {
      const abs = join(ctx.projectRoot, stale);
      if (existsSync(abs)) rmSync(abs);
    }
  }
```

（在文件顶部 import 补 `rmSync`。注意:此处 `listNotes` 读的是切到 main 后的工作树,故能列出 main 上的旧路径。）

(d) commit 路径(约 158–163 行):`researchPaths` 改为基于 `git add -A notes/` 语义——用 `-A` 让 move 的增删都进暂存:

把 `gitops.commit({ paths: researchPaths, ... })` 之前,先单独 stage notes 子树。最小改动:把 `candidatePaths` 里所有 `notes/...` 项替换为单个 `'notes'` 目录交给 `git add`(execa 的 `git add notes` 会纳入增删):

```typescript
  const researchPaths = ['notes', 'README.md', 'report.md', 'papers/README.md',
    '.researcher/project.yaml', '.researcher/thesis.md', '.researcher/.gitignore']
    .filter((p) => existsSync(join(ctx.projectRoot, p)));
```

（`git add notes` 暂存整个子树的增/删/改,等价于 `-A` 限定在 notes/，覆盖 move。）

- [ ] **Step 8: package_feed 同步**

`src/pipeline/package_feed.ts`(约 50–66 行):把 `join('notes', ctx.newNoteFilename!)` 与 `LANDSCAPE` 两项合并为目录 `'notes'`,使 feed 单提交也纳入 move 的增删:

```typescript
  const paths = [
    'notes',
    'README.md',
    'report.md',
    'papers/README.md',
    '.researcher/state/seen.jsonl',
    '.researcher/state/watermark.json',
  ].filter((p) => existsSync(join(ctx.projectRoot, p)));
```

- [ ] **Step 9: 跑全部相关测试确认通过**

Run: `npx vitest run tests/pipeline tests/commands`
Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add src/pipeline/synthesize.ts prompts/stage-synthesize.md src/pipeline/package.ts src/pipeline/package_feed.ts tests/pipeline/synthesize.test.ts tests/commands/run.test.ts
git commit -m "feat(48): zone-aware synthesize prompt + move-aware package commit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11(可选 / 可推迟):LLM 语义边界裁决

> 机械骨架(Task 1–10)已完整交付熵减。本任务加入"相关度"语义信号,只对**跨越 active/buffer 与 buffer/history 上限边界**的少数候选调一次 LLM,结合当前 thesis 微调其目标分区。无边界候选时不调 LLM。可在主体合入后单独排期。

**Files:**
- Create: `prompts/stage-rebalance.md`
- Modify: `src/pipeline/rebalance.ts`
- Test: `tests/pipeline/rebalance.test.ts`

**Interfaces:**
- Consumes: `ctx.adapter`、`ctx.thesis.body`、`loadPromptTemplate`/`renderTemplate`、`assertAgentOk`。
- Produces: rebalance 在算分后、`assignZones` 前,识别边界窗口(每个上限 ±`BOUNDARY_WINDOW=2` 名次)的候选;若非空,调 adapter 写 `zone-decisions.json`(`{ decisions: [{ num, zone, reason }] }`),据此把候选的 score 钳到目标区(promote = 抬到该区下界之上,demote = 压到该区上界之下),再跑 `assignZones`。解析失败或无候选 → 跳过,纯机械。

- [ ] **Step 1: 写失败测试**

```typescript
it('applies LLM boundary override to lift a relevant note back into active', async () => {
  // 6 notes; mechanical caps would push 02 to buffer, but LLM says 02 is thesis-critical → active.
  // StubAdapter writes zone-decisions.json with {num:2, zone:'active'}.
  // assert notes/active/02_*.md exists after rebalance.
});
```

（用按 `userPrompt` 含 `rebalance` 关键字判定的 stub adapter,写决策文件到 `ctx.runDir.path('zone-decisions.json')`。）

- [ ] **Step 2: 跑测试确认失败** — FAIL。

- [ ] **Step 3: 实现** — 在 `rebalance.ts` 算分后插入边界窗口识别 + adapter 调用 + 决策应用;新建 `prompts/stage-rebalance.md`(输入:thesis + 候选表[num/heat/recency/当前 zone],输出:仅候选的最终 zone + 一句理由,写 `{{decisions_path}}`)。

- [ ] **Step 4: 跑测试确认通过** — PASS。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/rebalance.ts prompts/stage-rebalance.md tests/pipeline/rebalance.test.ts
git commit -m "feat(48): LLM boundary adjudication for zone rebalance (relevance signal)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾:全量回归

- [ ] Run: `npx tsc --noEmit` → 无类型错误。
- [ ] Run: `npx vitest run` → 全绿。
- [ ] Run: `npm run build`（若存在）→ 成功。
- [ ] 人工 review:`prompts/stage-synthesize.md`、`stage-read.md`、`methodology/01-reading.md` 措辞一致;`docs/design/48-landscape-zoning.md` 与实现无偏差(有偏差则回写文档)。

## Self-Review 覆盖核对(spec → task)

- 三区 frontmatter 单一事实源 → Task 2、3、7、8。
- 物理目录 + 编号即身份 → Task 3、5、7、8。
- 复合排名(热度+时间衰减)→ Task 4、8;相关度(LLM)→ Task 11。
- `active_max`/`buffer_max` 软上限 → Task 1、4、8。
- 滞回(min_dwell/dwell)→ Task 1、2、4、8。
- pin 永不移动 → Task 2、4、8。
- pipeline `... read → rebalance → synthesize ...` → Task 6、9。
- synthesize 按区渲染 + 路径链接随移动 → Task 10。
- package/feed move 感知提交(最大风险面)→ Task 10。
- 两条路径都触发 → Task 9。
- 不可变性开口子(只移动+改 frontmatter)→ Task 8 实现约束 + Task 7/10 prompt 约束。
- 显式 deferred(老库回填工具、web 可视化、排名学习)→ 不在本计划,留 issue #48 deferred 段。
