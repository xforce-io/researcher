# `researcher onboard` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `researcher onboard` command — an Ink-based interactive TUI that takes a fresh directory through pre-flight checks → template scaffold → guided Q&A → batch LLM rewrite of `project.yaml` + `thesis.md` → diff review → single initial commit, with optional first-paper kickoff.

**Architecture:** New `src/onboard/` module (parser, state, rewrite, persist, all-templates check, Ink TUI). Reuses existing `src/adapter/claude-code.ts` for the single batch rewrite call. Refactors `src/commands/init.ts` to expose a `scaffoldTopicRepo` kernel callable both by `runInit` and `runOnboard`. Question script lives at `methodology/onboarding.md` (new eighth methodology document), parsed at runtime so users can edit it via `researcher methodology edit onboarding.md`.

**Tech Stack:**
- Existing: TypeScript 5, Node 20+, `commander`, `execa`, `js-yaml`, `vitest`
- New: `ink` (^5), `react` (^18), `@types/react` (dev), `ink-testing-library` (dev)

**Spec source:** `docs/superpowers/specs/2026-04-27-researcher-onboard-design.md`

**Non-goals (out of this plan):** re-onboarding/recalibration, search-driven seed paper suggestion, schema versioning beyond v1, i18n.

**Spec deviation flagged for review:** Spec §3 step 3 says "User can navigate back to previous questions before submission." This plan implements forward-only walking; the only re-do path is `[r] re-answer` in DiffReview which restarts from Q1. Rationale: backward mid-walk navigation adds non-trivial state machine complexity (per-question previous answer recall, re-render with prefilled text), while DiffReview's re-answer is a coarser-but-sufficient escape hatch for v1. If you want true backward nav, say so before execution — it's ~30 lines added to `<App>` and one new test in Task 11.

---

## File Structure

```
researcher/
├── methodology/
│   └── onboarding.md                     # NEW — question script + style guide
├── src/
│   ├── commands/
│   │   ├── init.ts                       # MODIFY — extract scaffoldTopicRepo()
│   │   └── onboard.ts                    # NEW — runOnboard() orchestration
│   ├── onboard/                          # NEW directory
│   │   ├── schema.ts                     # parse onboarding.md → Question[]
│   │   ├── state.ts                      # Answer collection + skip semantics
│   │   ├── all-templates-check.ts        # byte-compare scaffolded files to templates
│   │   ├── rewrite.ts                    # compose prompt + call adapter + parse response
│   │   ├── persist.ts                    # write files + git commit + run log
│   │   └── tui.tsx                       # Ink components: QuestionScreen, DiffReview, App
│   ├── cli.ts                            # MODIFY — register `onboard` subcommand
│   └── commands/methodology.ts           # MODIFY — add onboarding.md to FILES list
├── templates/
│   └── project.yaml                      # MODIFY — add meta.topic_oneline placeholder
└── tests/
    ├── onboard/                          # NEW directory
    │   ├── schema.test.ts
    │   ├── state.test.ts
    │   ├── all-templates-check.test.ts
    │   ├── rewrite.test.ts
    │   ├── persist.test.ts
    │   └── tui.test.tsx
    └── commands/
        └── onboard.test.ts                # NEW — integration test for runOnboard
```

---

## Task 1: Refactor `runInit` and update `project.yaml` template

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `templates/project.yaml`
- Test: `tests/commands/init.test.ts` (existing tests must continue to pass)

- [ ] **Step 1: Update template — add `meta:` section to `templates/project.yaml`**

Replace the entire file with:

```yaml
# project.yaml — structured project soul
# Edit this to declare your topic's research questions, criteria, sources.

meta:
  topic_oneline: ""

research_questions:
  - id: RQ1
    text: "Replace this with your first research question."

inclusion_criteria:
  - "Must address one of the research questions above."

exclusion_criteria:
  - "Pure benchmark papers without methodological contribution."

sources:
  - kind: arxiv
    queries:
      - "your topic keyword"
    priority: high

paper_axes: []

cadence:
  default_interval_days: 7
  backoff_after_empty_runs: 3
```

- [ ] **Step 2: Refactor `src/commands/init.ts` to expose `scaffoldTopicRepo` kernel**

Replace the file with:

```typescript
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

export interface InitOptions {
  targetDir: string;
}

export interface ScaffoldOptions {
  /** Repo root (already validated to be a git toplevel). */
  repoRoot: string;
}

function gitToplevel(dir: string): string | null {
  try {
    const { stdout } = execaSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Validate that `targetDir` is the root of a git repo. Returns the canonical
 * git toplevel path. Throws with a user-readable message on failure.
 */
export function validateRepoRoot(targetDir: string): string {
  const toplevel = gitToplevel(targetDir);
  if (toplevel === null) {
    throw new Error(`${targetDir} is not inside a git repo (run \`git init\` first)`);
  }
  const targetReal = realpathSync(targetDir);
  if (targetReal !== toplevel) {
    throw new Error(`init must be run at the repo root (${toplevel}), not ${targetReal}`);
  }
  return toplevel;
}

/**
 * Copy templates into <repoRoot>/.researcher/. Pure file-system work — caller
 * is responsible for repo validation and "already onboarded" detection.
 */
export function scaffoldTopicRepo(opts: ScaffoldOptions): void {
  const target = resolveProjectResearcherDir(opts.repoRoot);
  if (existsSync(target)) {
    throw new Error(`${target} already exists`);
  }
  const pkg = resolvePackageRoot();
  mkdirSync(join(target, 'state'), { recursive: true });
  copyFileSync(join(pkg, 'templates/project.yaml'), join(target, 'project.yaml'));
  copyFileSync(join(pkg, 'templates/thesis.md'), join(target, 'thesis.md'));
  copyFileSync(join(pkg, 'templates/researcher-gitignore'), join(target, '.gitignore'));
  writeFileSync(join(target, 'state/seen.jsonl'), '');
}

export async function runInit(opts: InitOptions): Promise<void> {
  const repoRoot = validateRepoRoot(opts.targetDir);
  scaffoldTopicRepo({ repoRoot });
  const target = resolveProjectResearcherDir(opts.targetDir);
  process.stdout.write(`initialized ${target}\n`);
  process.stdout.write(`next steps:\n`);
  process.stdout.write(
    `  1. edit .researcher/project.yaml — declare your research questions and sources\n`
  );
  process.stdout.write(`  2. edit .researcher/thesis.md — state your working thesis\n`);
  process.stdout.write(
    `  3. run \`researcher methodology install\` once globally to install methodology\n`
  );
  process.stdout.write(
    `  4. then \`researcher add <arxiv_id>\` to ingest your first paper\n`
  );
}
```

- [ ] **Step 3: Run existing init tests; expect all pass**

Run: `npm test -- tests/commands/init.test.ts`
Expected: all 4 tests pass (the refactor preserves behavior; the new `meta:` line in the template is accepted because tests check existence and `.gitignore` content, not yaml structure).

- [ ] **Step 4: Commit**

```bash
git add src/commands/init.ts templates/project.yaml
git commit -m "refactor(init): extract scaffoldTopicRepo kernel; add meta to template"
```

---

## Task 2: Author `methodology/onboarding.md` and register in install

**Files:**
- Create: `methodology/onboarding.md`
- Modify: `src/commands/methodology.ts`
- Modify: `tests/commands/methodology.test.ts` (if existing test enumerates files; otherwise no test change needed)

- [ ] **Step 1: Create `methodology/onboarding.md`**

```markdown
---
version: 1
target_files:
  - project.yaml
  - thesis.md
---

# Onboarding Questions

Style guide for the rewrite step:
- Preserve user intent verbatim — never invent facts the user did not state.
- Tighten verbose answers into the methodology's voice (declarative, falsifiable, concrete).
- For YAML fields, output valid YAML; for thesis prose, output 3-6 sentences.
- If a question was skipped, leave the corresponding template content untouched and append a `# TODO: revisit after first few papers` comment on the relevant line.

## Q1 — topic_oneline
Required: true
Field: project.yaml > meta.topic_oneline
Question: "Describe your topic in one sentence — what is the artifact, who is the decision-maker, what's at stake?"
Style: declarative, concrete, name a domain.
Examples (good):
- "Decision-making policies inside LLM agents — when an agent should ask, plan, act, or escalate."
- "Trace-level observability signals for production AI agents."
Examples (bad):
- "AI agents." (too broad)
- "Decision agent stuff." (vague)

## Q2 — research_questions
Required: true
Field: project.yaml > research_questions[]
Question: "List 2-4 falsifiable research questions. Each should start with 'How' / 'When' / 'Whether'."
Min: 2
Max: 4
Style: each question must be answerable by reading papers; avoid yes/no questions about future predictions.
Examples (good):
- "How do current agent frameworks decide between asking the user vs acting autonomously?"
- "Whether decision-quality benchmarks correlate with deployment outcomes."
Examples (bad):
- "What is the future of AI?" (not falsifiable)
- "Is GPT-5 better at decisions?" (not literature-driven)

## Q3 — inclusion_criteria
Required: false
Field: project.yaml > inclusion_criteria[]
Question: "What must a paper have to be worth deep-reading?"
Style: concrete, observable signals.

## Q4 — exclusion_criteria
Required: false
Field: project.yaml > exclusion_criteria[]; thesis.md > `## Anti-patterns`
Question: "What kinds of papers do you intentionally reject?"
Style: name the failure mode, not the surface keyword.

## Q5 — taste
Required: false
Field: thesis.md > `## Taste`
Question: "List 3-5 preferences for what counts as a 'good' paper in this topic."
Min: 3
Max: 5
Style: each should be opinionated and falsifiable by a counter-example.

## Q6 — seed_keywords
Required: false
Field: project.yaml > sources[0].queries[]
Question: "What arXiv search keywords would surface the right papers?"
Style: 2-6 concrete phrases; avoid single common words.
```

- [ ] **Step 2: Add `onboarding.md` to the install list in `src/commands/methodology.ts`**

Edit the `FILES` constant (around line 6) to append `'onboarding.md'`:

```typescript
const FILES = [
  '01-reading.md',
  '02-source.md',
  '03-filtering.md',
  '04-synthesis.md',
  '05-verification.md',
  '06-writing.md',
  '07-cadence.md',
  'onboarding.md',
];
```

- [ ] **Step 3: Run methodology tests; expect all pass**

Run: `npm test -- tests/commands/methodology.test.ts`
Expected: pass. If a test asserts an exact count of installed files, update that assertion to match the new count (8).

- [ ] **Step 4: Commit**

```bash
git add methodology/onboarding.md src/commands/methodology.ts tests/commands/methodology.test.ts
git commit -m "feat(methodology): add onboarding.md as 8th discipline"
```

---

## Task 3: `src/onboard/schema.ts` — parse `onboarding.md`

**Files:**
- Create: `src/onboard/schema.ts`
- Test: `tests/onboard/schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/onboard/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOnboardingMd } from '../../src/onboard/schema.js';

const VALID = `---
version: 1
target_files:
  - project.yaml
  - thesis.md
---

# Onboarding Questions

## Q1 — topic_oneline
Required: true
Field: project.yaml > meta.topic_oneline
Question: "What is the topic?"
Style: concrete.
Examples (good):
- "Decision policies in LLM agents."
Examples (bad):
- "AI."

## Q2 — research_questions
Required: true
Field: project.yaml > research_questions[]
Question: "List 2-4 questions."
Min: 2
Max: 4
Style: falsifiable.
`;

describe('parseOnboardingMd', () => {
  it('parses frontmatter and questions', () => {
    const r = parseOnboardingMd(VALID);
    expect(r.version).toBe(1);
    expect(r.targetFiles).toEqual(['project.yaml', 'thesis.md']);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toMatchObject({
      id: 'Q1',
      fieldId: 'topic_oneline',
      required: true,
      field: 'project.yaml > meta.topic_oneline',
      question: 'What is the topic?',
      style: 'concrete.',
      examplesGood: ['Decision policies in LLM agents.'],
      examplesBad: ['AI.'],
    });
    expect(r.questions[1]).toMatchObject({
      id: 'Q2',
      required: true,
      min: 2,
      max: 4,
    });
  });

  it('throws when version is not 1', () => {
    const bad = VALID.replace('version: 1', 'version: 2');
    expect(() => parseOnboardingMd(bad)).toThrow(/version/);
  });

  it('throws on missing Field line with location info', () => {
    const bad = VALID.replace('Field: project.yaml > meta.topic_oneline\n', '');
    expect(() => parseOnboardingMd(bad)).toThrow(/Q1.*Field/);
  });

  it('throws on missing required heading', () => {
    const bad = VALID.replace('Required: true\n', '');
    expect(() => parseOnboardingMd(bad)).toThrow(/Q1.*Required/);
  });

  it('throws on bad question header format', () => {
    const bad = VALID.replace('## Q1 — topic_oneline', '## Q1 topic_oneline');
    expect(() => parseOnboardingMd(bad)).toThrow(/header/);
  });
});
```

- [ ] **Step 2: Run; expect FAIL (module missing)**

Run: `npm test -- tests/onboard/schema.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/onboard/schema.ts`**

```typescript
import { load as parseYaml } from 'js-yaml';

export interface Question {
  id: string;
  fieldId: string;
  required: boolean;
  field: string;
  question: string;
  style?: string;
  min?: number;
  max?: number;
  examplesGood: string[];
  examplesBad: string[];
}

export interface Onboarding {
  version: number;
  targetFiles: string[];
  questions: Question[];
}

interface Frontmatter {
  version: number;
  target_files: string[];
}

export function parseOnboardingMd(src: string): Onboarding {
  const fmMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (!fmMatch) throw new Error('onboarding.md: missing or malformed frontmatter');
  const fm = parseYaml(fmMatch[1]) as Frontmatter;
  if (fm.version !== 1) {
    throw new Error(`onboarding.md: unsupported version ${fm.version} (only 1 is supported)`);
  }
  if (!Array.isArray(fm.target_files) || fm.target_files.length === 0) {
    throw new Error('onboarding.md: target_files must be a non-empty list');
  }

  const body = fmMatch[2];
  const lines = body.split('\n');
  const questions: Question[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = /^## (Q\d+) — (\w+)\s*$/.exec(line);
    if (!h) {
      i++;
      continue;
    }
    const id = h[1];
    const fieldId = h[2];
    const startLine = i + 1;
    i++;
    // Collect block until next H2 or EOF
    const blockStart = i;
    while (i < lines.length && !/^## /.test(lines[i])) i++;
    const block = lines.slice(blockStart, i);
    questions.push(parseBlock(id, fieldId, block, startLine));
  }
  if (questions.length === 0) {
    throw new Error('onboarding.md: no questions found (expected `## Q<n> — <field_id>` headers)');
  }

  return {
    version: fm.version,
    targetFiles: fm.target_files,
    questions,
  };
}

function parseBlock(id: string, fieldId: string, block: string[], baseLine: number): Question {
  const get = (key: string): string | undefined => {
    const m = block.find((l) => l.startsWith(`${key}:`));
    return m?.slice(key.length + 1).trim();
  };

  const requiredRaw = get('Required');
  if (requiredRaw === undefined) {
    throw new Error(`onboarding.md: ${id} (line ${baseLine}) — missing 'Required:' line`);
  }
  const required = requiredRaw === 'true';
  const field = get('Field');
  if (!field) throw new Error(`onboarding.md: ${id} (line ${baseLine}) — missing 'Field:' line`);
  const questionRaw = get('Question');
  if (!questionRaw) throw new Error(`onboarding.md: ${id} (line ${baseLine}) — missing 'Question:' line`);
  const question = questionRaw.replace(/^"|"$/g, '');
  const style = get('Style');
  const min = get('Min') ? Number(get('Min')) : undefined;
  const max = get('Max') ? Number(get('Max')) : undefined;

  const examplesGood = collectExamples(block, 'Examples (good):');
  const examplesBad = collectExamples(block, 'Examples (bad):');

  return { id, fieldId, required, field, question, style, min, max, examplesGood, examplesBad };
}

function collectExamples(block: string[], header: string): string[] {
  const idx = block.findIndex((l) => l.trim() === header);
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < block.length; i++) {
    const m = /^- (.+)$/.exec(block[i]);
    if (!m) break;
    // Strip surrounding quotes if present
    out.push(m[1].replace(/^"|"$/g, '').replace(/" \(.*\)$/, ''));
  }
  return out;
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/schema.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/schema.ts tests/onboard/schema.test.ts
git commit -m "feat(onboard): parser for onboarding.md"
```

---

## Task 4: `src/onboard/state.ts` — Answer model

**Files:**
- Create: `src/onboard/state.ts`
- Test: `tests/onboard/state.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { OnboardingState, type Answer } from '../../src/onboard/state.js';
import type { Question } from '../../src/onboard/schema.js';

const Q1: Question = {
  id: 'Q1', fieldId: 'topic_oneline', required: true, field: 'project.yaml > meta.topic_oneline',
  question: 'topic?', examplesGood: [], examplesBad: [],
};
const Q2: Question = {
  id: 'Q2', fieldId: 'taste', required: false, field: 'thesis.md > Taste',
  question: 'taste?', examplesGood: [], examplesBad: [],
};

describe('OnboardingState', () => {
  it('records a free-text answer', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.answer('Q1', 'Decision policies in LLM agents.');
    expect(s.getAnswer('Q1')).toEqual({ kind: 'text', text: 'Decision policies in LLM agents.' });
  });

  it('marks an optional question as skipped', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.skip('Q2');
    expect(s.getAnswer('Q2')).toEqual({ kind: 'skipped' });
  });

  it('refuses to skip a required question', () => {
    const s = new OnboardingState([Q1, Q2]);
    expect(() => s.skip('Q1')).toThrow(/required/);
  });

  it('reports unanswered required questions', () => {
    const s = new OnboardingState([Q1, Q2]);
    expect(s.unansweredRequired()).toEqual(['Q1']);
    s.answer('Q1', 'x');
    expect(s.unansweredRequired()).toEqual([]);
  });

  it('serializes answers for prompt and run-log', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.answer('Q1', 'topic.');
    s.skip('Q2');
    expect(s.serialize()).toEqual([
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'topic.' },
      { questionId: 'Q2', fieldId: 'taste', kind: 'skipped' },
    ]);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/state.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/onboard/state.ts`**

```typescript
import type { Question } from './schema.js';

export type Answer = { kind: 'text'; text: string } | { kind: 'skipped' };

export interface SerializedAnswer {
  questionId: string;
  fieldId: string;
  kind: 'text' | 'skipped';
  text?: string;
}

export class OnboardingState {
  private readonly questions: Map<string, Question>;
  private readonly answers = new Map<string, Answer>();

  constructor(questions: Question[]) {
    this.questions = new Map(questions.map((q) => [q.id, q]));
  }

  answer(id: string, text: string): void {
    this.requireQuestion(id);
    this.answers.set(id, { kind: 'text', text });
  }

  skip(id: string): void {
    const q = this.requireQuestion(id);
    if (q.required) throw new Error(`cannot skip required question ${id}`);
    this.answers.set(id, { kind: 'skipped' });
  }

  getAnswer(id: string): Answer | undefined {
    return this.answers.get(id);
  }

  unansweredRequired(): string[] {
    const out: string[] = [];
    for (const q of this.questions.values()) {
      if (q.required && !this.answers.has(q.id)) out.push(q.id);
    }
    return out;
  }

  serialize(): SerializedAnswer[] {
    const out: SerializedAnswer[] = [];
    for (const q of this.questions.values()) {
      const a = this.answers.get(q.id);
      if (!a) continue;
      out.push(
        a.kind === 'text'
          ? { questionId: q.id, fieldId: q.fieldId, kind: 'text', text: a.text }
          : { questionId: q.id, fieldId: q.fieldId, kind: 'skipped' }
      );
    }
    return out;
  }

  private requireQuestion(id: string): Question {
    const q = this.questions.get(id);
    if (!q) throw new Error(`unknown question id: ${id}`);
    return q;
  }
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/state.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/state.ts tests/onboard/state.test.ts
git commit -m "feat(onboard): answer state model with skip semantics"
```

---

## Task 5: `src/onboard/all-templates-check.ts`

**Files:**
- Create: `src/onboard/all-templates-check.ts`
- Test: `tests/onboard/all-templates-check.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllTemplates } from '../../src/onboard/all-templates-check.js';
import { resolvePackageRoot } from '../../src/paths.js';

describe('isAllTemplates', () => {
  let dir: string;
  let pkgRoot: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-allt-'));
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
    pkgRoot = resolvePackageRoot();
  });

  it('returns true when files match templates byte-for-byte and seen.jsonl is empty', () => {
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      readFileSync(join(pkgRoot, 'templates/project.yaml'))
    );
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
    expect(isAllTemplates(dir)).toBe(true);
  });

  it('returns false when project.yaml differs from template', () => {
    writeFileSync(join(dir, '.researcher/project.yaml'), 'edited\n');
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
    expect(isAllTemplates(dir)).toBe(false);
  });

  it('returns false when seen.jsonl is non-empty', () => {
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      readFileSync(join(pkgRoot, 'templates/project.yaml'))
    );
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '{"id":"x"}\n');
    expect(isAllTemplates(dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/all-templates-check.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/onboard/all-templates-check.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

const FILE_MAP: Array<[string, string]> = [
  ['project.yaml', 'templates/project.yaml'],
  ['thesis.md', 'templates/thesis.md'],
  ['.gitignore', 'templates/researcher-gitignore'],
];

/**
 * True when the scaffolded `.researcher/` directory is in pristine post-init
 * state (every file matches the packaged template byte-for-byte and seen.jsonl
 * is empty). Used to decide whether `onboard` may proceed after a previously
 * aborted session.
 */
export function isAllTemplates(repoRoot: string): boolean {
  const dotR = resolveProjectResearcherDir(repoRoot);
  const pkg = resolvePackageRoot();
  for (const [target, tpl] of FILE_MAP) {
    const actual = safeRead(join(dotR, target));
    const expected = safeRead(join(pkg, tpl));
    if (actual === null || expected === null) return false;
    if (!actual.equals(expected)) return false;
  }
  const seen = safeRead(join(dotR, 'state/seen.jsonl'));
  if (seen === null) return false;
  if (seen.length > 0) return false;
  return true;
}

function safeRead(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/all-templates-check.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/all-templates-check.ts tests/onboard/all-templates-check.test.ts
git commit -m "feat(onboard): all-templates pre-flight check"
```

---

## Task 6: `src/onboard/rewrite.ts` — prompt + adapter call + parse

**Files:**
- Create: `src/onboard/rewrite.ts`
- Test: `tests/onboard/rewrite.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { rewriteAnswers } from '../../src/onboard/rewrite.js';
import type { Onboarding } from '../../src/onboard/schema.js';
import type { AgentRuntime, InvokeResult } from '../../src/adapter/interface.js';
import type { SerializedAnswer } from '../../src/onboard/state.js';

const ONBOARDING: Onboarding = {
  version: 1,
  targetFiles: ['project.yaml', 'thesis.md'],
  questions: [
    {
      id: 'Q1', fieldId: 'topic_oneline', required: true,
      field: 'project.yaml > meta.topic_oneline',
      question: 'topic?', examplesGood: [], examplesBad: [],
    },
  ],
};

function fakeRuntime(output: string): AgentRuntime {
  return {
    id: 'fake',
    invoke: vi.fn(async (): Promise<InvokeResult> => ({
      output, exitCode: 0, modifiedFiles: [],
    })),
  };
}

const VALID_RESPONSE = `Some commentary.

<<<PROJECT_YAML>>>
meta:
  topic_oneline: "Decision policies."
research_questions: []
<<<END_PROJECT_YAML>>>

<<<THESIS_MD>>>
# Thesis
## Working thesis
A test thesis.
<<<END_THESIS_MD>>>
`;

describe('rewriteAnswers', () => {
  it('builds prompt and parses two-block response', async () => {
    const rt = fakeRuntime(VALID_RESPONSE);
    const answers: SerializedAnswer[] = [
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'decision policies' },
    ];
    const r = await rewriteAnswers({
      runtime: rt,
      cwd: '/tmp',
      methodologyBody: 'STYLE GUIDE',
      onboarding: ONBOARDING,
      answers,
      templateProjectYaml: 'meta:\n  topic_oneline: ""\n',
      templateThesisMd: '# Thesis\n',
    });
    expect(r.projectYaml).toContain('Decision policies');
    expect(r.thesisMd).toContain('Working thesis');

    const call = (rt.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.userPrompt).toContain('Q1');
    expect(call.userPrompt).toContain('decision policies');
    expect(call.systemPrompt).toContain('STYLE GUIDE');
  });

  it('throws when response is missing PROJECT_YAML block', async () => {
    const rt = fakeRuntime('only commentary, no blocks');
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/PROJECT_YAML/);
  });

  it('throws when project.yaml block fails YAML parsing', async () => {
    const bad = VALID_RESPONSE.replace(
      'meta:\n  topic_oneline: "Decision policies."',
      'meta:\n  topic_oneline: "unterminated'
    );
    const rt = fakeRuntime(bad);
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/yaml/i);
  });

  it('throws when adapter returns non-zero exit', async () => {
    const rt: AgentRuntime = {
      id: 'fake',
      invoke: async () => ({ output: '', exitCode: 1, modifiedFiles: [] }),
    };
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/exit code 1/);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/rewrite.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/onboard/rewrite.ts`**

```typescript
import { load as parseYaml } from 'js-yaml';
import type { AgentRuntime } from '../adapter/interface.js';
import type { Onboarding } from './schema.js';
import type { SerializedAnswer } from './state.js';

export interface RewriteOptions {
  runtime: AgentRuntime;
  cwd: string;
  methodologyBody: string;
  onboarding: Onboarding;
  answers: SerializedAnswer[];
  templateProjectYaml: string;
  templateThesisMd: string;
  timeoutMs?: number;
}

export interface RewriteResult {
  projectYaml: string;
  thesisMd: string;
  rawOutput: string;
}

export async function rewriteAnswers(opts: RewriteOptions): Promise<RewriteResult> {
  const systemPrompt = composeSystemPrompt(opts.methodologyBody);
  const userPrompt = composeUserPrompt(opts);
  const result = await opts.runtime.invoke({
    cwd: opts.cwd,
    systemPrompt,
    userPrompt,
    timeoutMs: opts.timeoutMs ?? 5 * 60 * 1000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`agent runtime exit code ${result.exitCode}`);
  }
  const parsed = parseResponse(result.output);
  return { ...parsed, rawOutput: result.output };
}

export function composeSystemPrompt(methodologyBody: string): string {
  return [
    'You are the researcher onboarding assistant.',
    'Rewrite the user\'s rough answers into the topic\'s project.yaml and thesis.md.',
    'Follow the style guide below verbatim. Preserve user intent. Do not invent facts.',
    '',
    '--- METHODOLOGY: ONBOARDING.MD ---',
    methodologyBody,
    '--- END METHODOLOGY ---',
  ].join('\n');
}

export function composeUserPrompt(opts: RewriteOptions): string {
  const lines: string[] = [];
  lines.push('# User answers');
  for (const a of opts.answers) {
    lines.push('');
    lines.push(`## ${a.questionId} (${a.fieldId})`);
    if (a.kind === 'skipped') {
      lines.push('SKIPPED — preserve template default and append `# TODO: revisit after first few papers`.');
    } else {
      lines.push(a.text ?? '');
    }
  }
  lines.push('');
  lines.push('# Current project.yaml template');
  lines.push('```yaml');
  lines.push(opts.templateProjectYaml);
  lines.push('```');
  lines.push('');
  lines.push('# Current thesis.md template');
  lines.push('```markdown');
  lines.push(opts.templateThesisMd);
  lines.push('```');
  lines.push('');
  lines.push('# Output format');
  lines.push('Emit exactly two blocks, in this order, with these literal markers:');
  lines.push('');
  lines.push('<<<PROJECT_YAML>>>');
  lines.push('...rewritten project.yaml content (must be valid YAML)...');
  lines.push('<<<END_PROJECT_YAML>>>');
  lines.push('');
  lines.push('<<<THESIS_MD>>>');
  lines.push('...rewritten thesis.md content...');
  lines.push('<<<END_THESIS_MD>>>');
  return lines.join('\n');
}

export function parseResponse(output: string): RewriteResult {
  const yamlMatch = /<<<PROJECT_YAML>>>\n([\s\S]*?)\n<<<END_PROJECT_YAML>>>/.exec(output);
  if (!yamlMatch) throw new Error('rewrite response: missing PROJECT_YAML block');
  const mdMatch = /<<<THESIS_MD>>>\n([\s\S]*?)\n<<<END_THESIS_MD>>>/.exec(output);
  if (!mdMatch) throw new Error('rewrite response: missing THESIS_MD block');
  const projectYaml = yamlMatch[1];
  const thesisMd = mdMatch[1];
  try {
    parseYaml(projectYaml);
  } catch (e) {
    throw new Error(`rewrite response: project.yaml is not valid yaml — ${(e as Error).message}`);
  }
  return { projectYaml, thesisMd };
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/rewrite.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/rewrite.ts tests/onboard/rewrite.test.ts
git commit -m "feat(onboard): rewrite answers via agent runtime with two-block protocol"
```

---

## Task 7: `src/onboard/persist.ts` — write files + commit + run log

**Files:**
- Create: `src/onboard/persist.ts`
- Test: `tests/onboard/persist.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { writeOnboardArtifacts, writeRunLog } from '../../src/onboard/persist.js';

describe('writeOnboardArtifacts', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-persist-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: dir });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
    writeFileSync(join(dir, '.researcher/project.yaml'), 'placeholder\n');
    writeFileSync(join(dir, '.researcher/thesis.md'), 'placeholder\n');
    writeFileSync(join(dir, '.researcher/.gitignore'), 'state/runs/\n');
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
    execaSync('git', ['add', '.'], { cwd: dir });
    execaSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  });

  it('writes both files and creates a single commit', async () => {
    await writeOnboardArtifacts({
      repoRoot: dir,
      projectYaml: 'meta:\n  topic_oneline: "x"\n',
      thesisMd: '# Thesis\n',
      slug: 'decision-agent',
    });
    expect(readFileSync(join(dir, '.researcher/project.yaml'), 'utf8')).toContain('decision-agent'.length > 0 ? 'topic_oneline' : '');
    expect(readFileSync(join(dir, '.researcher/thesis.md'), 'utf8')).toContain('Thesis');
    const log = execaSync('git', ['log', '--oneline'], { cwd: dir }).stdout;
    expect(log).toContain('researcher: onboard decision-agent');
  });
});

describe('writeRunLog', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-runlog-'));
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
  });

  it('writes answers/prompt/response/result files under state/runs/onboard-<ts>/', () => {
    const runDir = writeRunLog({
      repoRoot: dir,
      answers: [{ questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 't' }],
      prompt: 'P',
      response: 'R',
      result: { status: 'ok' },
    });
    expect(existsSync(runDir)).toBe(true);
    expect(readFileSync(join(runDir, 'prompt.txt'), 'utf8')).toBe('P');
    expect(readFileSync(join(runDir, 'response.txt'), 'utf8')).toBe('R');
    expect(JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'))).toEqual({ status: 'ok' });
    expect(JSON.parse(readFileSync(join(runDir, 'answers.json'), 'utf8'))).toHaveLength(1);
    const entries = readdirSync(join(dir, '.researcher/state/runs'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^onboard-/);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/persist.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/onboard/persist.ts`**

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit } from '../git/ops.js';
import { resolveProjectResearcherDir } from '../paths.js';
import type { SerializedAnswer } from './state.js';

export interface WriteArtifactsOptions {
  repoRoot: string;
  projectYaml: string;
  thesisMd: string;
  slug: string;
}

export async function writeOnboardArtifacts(opts: WriteArtifactsOptions): Promise<void> {
  const dotR = resolveProjectResearcherDir(opts.repoRoot);
  writeFileSync(join(dotR, 'project.yaml'), opts.projectYaml);
  writeFileSync(join(dotR, 'thesis.md'), opts.thesisMd);
  await commit({
    cwd: opts.repoRoot,
    paths: ['.researcher/project.yaml', '.researcher/thesis.md'],
    message: `researcher: onboard ${opts.slug}`,
  });
}

export type RunStatus = 'ok' | 'rewrite_failed' | 'schema_invalid' | 'user_aborted';

export interface RunResult {
  status: RunStatus;
  error?: string;
}

export interface WriteRunLogOptions {
  repoRoot: string;
  answers: SerializedAnswer[];
  prompt: string;
  response: string;
  result: RunResult;
}

export function writeRunLog(opts: WriteRunLogOptions): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(
    resolveProjectResearcherDir(opts.repoRoot),
    'state',
    'runs',
    `onboard-${ts}`
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'answers.json'), JSON.stringify(opts.answers, null, 2));
  writeFileSync(join(runDir, 'prompt.txt'), opts.prompt);
  writeFileSync(join(runDir, 'response.txt'), opts.response);
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(opts.result, null, 2));
  return runDir;
}

/**
 * Slugify Q1 answer for use in commit message: lowercase, alnum + hyphens, max 40 chars.
 */
export function makeSlug(topicOneline: string): string {
  const s = topicOneline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'topic';
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/persist.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/persist.ts tests/onboard/persist.test.ts
git commit -m "feat(onboard): persist artifacts, commit, and run log"
```

---

## Task 8: Add Ink and React dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
npm install --save ink@^5.0.0 react@^18.3.0
npm install --save-dev @types/react@^18.3.0 ink-testing-library@^4.0.0
```

- [ ] **Step 2: Verify package.json updates**

Run: `cat package.json | grep -E "(ink|react)"`
Expected: shows `"ink": "^5.x"`, `"react": "^18.x"`, `"@types/react": "^18.x"`, `"ink-testing-library": "^4.x"`.

- [ ] **Step 3: Verify build still passes**

Run: `npm run build`
Expected: clean build (no JSX yet, but tsconfig must allow it — see step 4 if it fails).

- [ ] **Step 4: If build fails, enable JSX in `tsconfig.json`**

Read `tsconfig.json` and ensure compilerOptions includes:

```json
"jsx": "react-jsx",
"esModuleInterop": true
```

If missing, add them and re-run `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: add ink and react for onboard TUI"
```

---

## Task 9: `<QuestionScreen>` Ink component

**Files:**
- Create: `src/onboard/tui.tsx`
- Test: `tests/onboard/tui.test.tsx`

This task introduces the file with just `<QuestionScreen>`. Subsequent tasks add `<DiffReview>` and `<App>` to the same file.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { QuestionScreen } from '../../src/onboard/tui.js';
import type { Question } from '../../src/onboard/schema.js';

const Q: Question = {
  id: 'Q1', fieldId: 'topic_oneline', required: true,
  field: 'project.yaml > meta.topic_oneline',
  question: 'Describe your topic in one sentence.',
  style: 'concrete',
  examplesGood: ['Decision policies in LLM agents.'],
  examplesBad: ['AI agents.'],
};

describe('<QuestionScreen>', () => {
  it('renders question, examples, and a free-text prompt', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { lastFrame } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    const out = lastFrame();
    expect(out).toContain('Q1');
    expect(out).toContain('Describe your topic');
    expect(out).toContain('Decision policies in LLM agents.');
    expect(out).toContain('Examples (bad)');
  });

  it('calls onSubmit with typed text on Enter', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { stdin } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    stdin.write('hello world');
    stdin.write('\r'); // Enter
    expect(onSubmit).toHaveBeenCalledWith('hello world');
  });

  it('does not allow skip for required question', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { lastFrame, stdin } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    expect(lastFrame()).not.toContain('skip');
    stdin.write(''); // Esc
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('allows skip for optional question via Esc', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const optional: Question = { ...Q, required: false };
    const { lastFrame, stdin } = render(
      <QuestionScreen question={optional} onSubmit={onSubmit} onSkip={onSkip} />
    );
    expect(lastFrame()).toContain('skip');
    stdin.write('');
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/tui.test.tsx`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/onboard/tui.tsx` (QuestionScreen only)**

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Question } from './schema.js';

export interface QuestionScreenProps {
  question: Question;
  onSubmit: (text: string) => void;
  onSkip: () => void;
}

export function QuestionScreen(props: QuestionScreenProps): React.JSX.Element {
  const { question: q, onSubmit, onSkip } = props;
  const [text, setText] = useState('');

  useInput((input, key) => {
    if (key.return) {
      if (text.trim().length > 0) onSubmit(text);
      return;
    }
    if (key.escape) {
      if (!q.required) onSkip();
      return;
    }
    if (key.backspace || key.delete) {
      setText((t) => t.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setText((t) => t + input);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{q.id} — {q.fieldId}{q.required ? '' : ' (optional)'}</Text>
      <Box marginTop={1}><Text>{q.question}</Text></Box>
      {q.style && <Box marginTop={1}><Text dimColor>Style: {q.style}</Text></Box>}
      {q.examplesGood.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">Examples (good):</Text>
          {q.examplesGood.map((e, i) => <Text key={i} color="green">  • {e}</Text>)}
        </Box>
      )}
      {q.examplesBad.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">Examples (bad):</Text>
          {q.examplesBad.map((e, i) => <Text key={i} color="red">  • {e}</Text>)}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>{'> '}</Text>
        <Text>{text}</Text>
        <Text inverse> </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Enter to submit{q.required ? '' : ' · Esc to skip'}
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/tui.test.tsx`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/tui.tsx tests/onboard/tui.test.tsx
git commit -m "feat(onboard): QuestionScreen component"
```

---

## Task 10: `<DiffReview>` Ink component

**Files:**
- Modify: `src/onboard/tui.tsx`
- Modify: `tests/onboard/tui.test.tsx`

- [ ] **Step 1: Append failing test to `tests/onboard/tui.test.tsx`**

Add at the bottom of the file:

```typescript
import { DiffReview } from '../../src/onboard/tui.js';

describe('<DiffReview>', () => {
  const before = { projectYaml: 'old yaml', thesisMd: 'old thesis' };
  const after = { projectYaml: 'NEW yaml', thesisMd: 'NEW thesis' };

  it('renders both file diffs', () => {
    const { lastFrame } = render(
      <DiffReview before={before} after={after} onAccept={() => {}} onReanswer={() => {}} onAbort={() => {}} />
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('project.yaml');
    expect(out).toContain('thesis.md');
    expect(out).toContain('NEW yaml');
  });

  it('calls onAccept on "a"', () => {
    const onAccept = vi.fn();
    const { stdin } = render(
      <DiffReview before={before} after={after} onAccept={onAccept} onReanswer={() => {}} onAbort={() => {}} />
    );
    stdin.write('a');
    expect(onAccept).toHaveBeenCalled();
  });

  it('calls onAbort on "x"', () => {
    const onAbort = vi.fn();
    const { stdin } = render(
      <DiffReview before={before} after={after} onAccept={() => {}} onReanswer={() => {}} onAbort={onAbort} />
    );
    stdin.write('x');
    expect(onAbort).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/tui.test.tsx`
Expected: FAIL with "DiffReview is not defined".

- [ ] **Step 3: Append `<DiffReview>` to `src/onboard/tui.tsx`**

Add to the file:

```tsx
export interface DiffReviewProps {
  before: { projectYaml: string; thesisMd: string };
  after: { projectYaml: string; thesisMd: string };
  onAccept: () => void;
  onReanswer: () => void;
  onAbort: () => void;
}

export function DiffReview(props: DiffReviewProps): React.JSX.Element {
  useInput((input) => {
    if (input === 'a') props.onAccept();
    if (input === 'r') props.onReanswer();
    if (input === 'x') props.onAbort();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Review rewritten files</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">─── project.yaml (before → after) ───</Text>
        <Text dimColor>{props.before.projectYaml}</Text>
        <Text>{props.after.projectYaml}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">─── thesis.md (before → after) ───</Text>
        <Text dimColor>{props.before.thesisMd}</Text>
        <Text>{props.after.thesisMd}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[a] accept · [r] re-answer · [x] abort</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/tui.test.tsx`
Expected: all 7 tests pass (4 from Task 9 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/onboard/tui.tsx tests/onboard/tui.test.tsx
git commit -m "feat(onboard): DiffReview component"
```

---

## Task 11: `<App>` state machine

**Files:**
- Modify: `src/onboard/tui.tsx`
- Modify: `tests/onboard/tui.test.tsx`

`<App>` runs the full TUI: walks questions in order, on completion calls `onAllAnswered` (the orchestrator hands back rewritten content), then renders `<DiffReview>`. Final action calls one of `onCommit` / `onAbort`.

- [ ] **Step 1: Append failing test**

```typescript
import { App } from '../../src/onboard/tui.js';

describe('<App>', () => {
  const questions: Question[] = [
    { id: 'Q1', fieldId: 'topic_oneline', required: true, field: 'f', question: 'q1?', examplesGood: [], examplesBad: [] },
    { id: 'Q2', fieldId: 'taste', required: false, field: 'f', question: 'q2?', examplesGood: [], examplesBad: [] },
  ];

  it('walks all questions then calls onAllAnswered with serialized answers', async () => {
    const onAllAnswered = vi.fn(async () => ({
      before: { projectYaml: 'b', thesisMd: 'b' },
      after: { projectYaml: 'a', thesisMd: 'a' },
    }));
    const { stdin } = render(
      <App questions={questions} onAllAnswered={onAllAnswered} onCommit={() => {}} onAbort={() => {}} />
    );
    stdin.write('first answer');
    stdin.write('\r');
    stdin.write(''); // skip Q2
    await new Promise((r) => setTimeout(r, 20));
    expect(onAllAnswered).toHaveBeenCalled();
    const arg = onAllAnswered.mock.calls[0][0];
    expect(arg).toEqual([
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'first answer' },
      { questionId: 'Q2', fieldId: 'taste', kind: 'skipped' },
    ]);
  });

  it('calls onCommit with rewritten content on accept', async () => {
    const onCommit = vi.fn();
    const { stdin } = render(
      <App
        questions={questions}
        onAllAnswered={async () => ({
          before: { projectYaml: 'b', thesisMd: 'b' },
          after: { projectYaml: 'a', thesisMd: 'a' },
        })}
        onCommit={onCommit}
        onAbort={() => {}}
      />
    );
    stdin.write('answer');
    stdin.write('\r');
    stdin.write('');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('a');
    expect(onCommit).toHaveBeenCalledWith(
      { projectYaml: 'a', thesisMd: 'a' },
      'answer'
    );
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/onboard/tui.test.tsx`
Expected: FAIL with "App is not defined".

- [ ] **Step 3: Append `<App>` to `src/onboard/tui.tsx`**

```tsx
import { OnboardingState, type SerializedAnswer } from './state.js';

export interface AppProps {
  questions: Question[];
  onAllAnswered: (answers: SerializedAnswer[]) => Promise<{
    before: { projectYaml: string; thesisMd: string };
    after: { projectYaml: string; thesisMd: string };
  }>;
  onCommit: (
    rewritten: { projectYaml: string; thesisMd: string },
    topicOneline: string
  ) => void;
  onAbort: () => void;
}

type Phase =
  | { kind: 'asking'; idx: number }
  | { kind: 'rewriting' }
  | { kind: 'reviewing'; before: { projectYaml: string; thesisMd: string }; after: { projectYaml: string; thesisMd: string } }
  | { kind: 'errored'; error: string };

export function App(props: AppProps): React.JSX.Element {
  const stateRef = React.useRef(new OnboardingState(props.questions));
  const [phase, setPhase] = useState<Phase>({ kind: 'asking', idx: 0 });

  const advanceFrom = (idx: number): void => {
    if (idx < props.questions.length - 1) {
      setPhase({ kind: 'asking', idx: idx + 1 });
      return;
    }
    setPhase({ kind: 'rewriting' });
    void (async () => {
      try {
        const { before, after } = await props.onAllAnswered(stateRef.current.serialize());
        setPhase({ kind: 'reviewing', before, after });
      } catch (e) {
        setPhase({ kind: 'errored', error: (e as Error).message });
      }
    })();
  };

  if (phase.kind === 'asking') {
    const q = props.questions[phase.idx];
    return (
      <QuestionScreen
        question={q}
        onSubmit={(text) => {
          stateRef.current.answer(q.id, text);
          advanceFrom(phase.idx);
        }}
        onSkip={() => {
          stateRef.current.skip(q.id);
          advanceFrom(phase.idx);
        }}
      />
    );
  }

  if (phase.kind === 'rewriting') {
    return (
      <Box paddingX={1}>
        <Text>Rewriting answers via agent runtime…</Text>
      </Box>
    );
  }

  if (phase.kind === 'errored') {
    return (
      <Box paddingX={1} flexDirection="column">
        <Text color="red">Rewrite failed: {phase.error}</Text>
        <Text dimColor>Raw answers preserved in /tmp; re-run `researcher onboard`.</Text>
      </Box>
    );
  }

  // reviewing
  const a1 = stateRef.current.getAnswer('Q1');
  const topicOneline = a1?.kind === 'text' ? a1.text : '';
  return (
    <DiffReview
      before={phase.before}
      after={phase.after}
      onAccept={() => props.onCommit(phase.after, topicOneline)}
      onReanswer={() => setPhase({ kind: 'asking', idx: 0 })}
      onAbort={() => props.onAbort()}
    />
  );
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test -- tests/onboard/tui.test.tsx`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/onboard/tui.tsx tests/onboard/tui.test.tsx
git commit -m "feat(onboard): App state machine ties screens together"
```

---

## Task 12: `src/commands/onboard.ts` orchestration + CLI registration

**Files:**
- Create: `src/commands/onboard.ts`
- Modify: `src/cli.ts`
- Test: `tests/commands/onboard.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runOnboard } from '../../src/commands/onboard.js';
import { resolvePackageRoot } from '../../src/paths.js';

// Stub the adapter so the test does not call real `claude`.
vi.mock('../../src/adapter/claude-code.js', () => ({
  ClaudeCodeAdapter: class {
    id = 'fake';
    async invoke() {
      return {
        exitCode: 0,
        modifiedFiles: [],
        output: [
          '<<<PROJECT_YAML>>>',
          'meta:',
          '  topic_oneline: "Decision policies."',
          'research_questions:',
          '  - id: RQ1',
          '    text: "How do agents decide?"',
          '<<<END_PROJECT_YAML>>>',
          '',
          '<<<THESIS_MD>>>',
          '# Thesis',
          '## Working thesis',
          'Test thesis.',
          '<<<END_THESIS_MD>>>',
        ].join('\n'),
      };
    }
  },
}));

describe('runOnboard (integration)', () => {
  let dir: string;
  let methHome: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-onboard-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: dir });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
    methHome = mkdtempSync(join(tmpdir(), 'r-meth-'));
    process.env.RESEARCHER_HOME = methHome;
    mkdirSync(join(methHome, 'methodology'));
    const pkg = resolvePackageRoot();
    writeFileSync(
      join(methHome, 'methodology', 'onboarding.md'),
      readFileSync(join(pkg, 'methodology', 'onboarding.md'))
    );
  });

  it('produces a topic repo with project.yaml + thesis.md committed (TUI auto-driver)', async () => {
    await runOnboard({
      cwd: dir,
      // Test-only injection: feed pre-baked answers, skip TUI rendering
      answersOverride: [
        { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'decision agent topic' },
        { questionId: 'Q2', fieldId: 'research_questions', kind: 'text', text: 'How do agents decide?' },
        { questionId: 'Q3', fieldId: 'inclusion_criteria', kind: 'skipped' },
        { questionId: 'Q4', fieldId: 'exclusion_criteria', kind: 'skipped' },
        { questionId: 'Q5', fieldId: 'taste', kind: 'skipped' },
        { questionId: 'Q6', fieldId: 'seed_keywords', kind: 'skipped' },
      ],
      autoAcceptDiff: true,
    });

    expect(existsSync(join(dir, '.researcher/project.yaml'))).toBe(true);
    expect(readFileSync(join(dir, '.researcher/project.yaml'), 'utf8')).toContain('Decision policies');
    expect(readFileSync(join(dir, '.researcher/thesis.md'), 'utf8')).toContain('Working thesis');
    const log = execaSync('git', ['log', '--oneline'], { cwd: dir }).stdout;
    expect(log).toMatch(/researcher: onboard /);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npm test -- tests/commands/onboard.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/commands/onboard.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import React from 'react';
import { render } from 'ink';
import { resolvePackageRoot, resolveProjectResearcherDir, resolveResearcherHome } from '../paths.js';
import { scaffoldTopicRepo, validateRepoRoot } from './init.js';
import { ClaudeCodeAdapter } from '../adapter/claude-code.js';
import { parseOnboardingMd } from '../onboard/schema.js';
import { isAllTemplates } from '../onboard/all-templates-check.js';
import { rewriteAnswers, composeUserPrompt, composeSystemPrompt } from '../onboard/rewrite.js';
import { writeOnboardArtifacts, writeRunLog, makeSlug } from '../onboard/persist.js';
import { App } from '../onboard/tui.js';
import type { SerializedAnswer } from '../onboard/state.js';

export interface OnboardOptions {
  cwd: string;
  /** Test-only: bypass TUI and feed answers directly. */
  answersOverride?: SerializedAnswer[];
  /** Test-only: auto-accept diff review. */
  autoAcceptDiff?: boolean;
}

export async function runOnboard(opts: OnboardOptions): Promise<void> {
  preFlight(opts.cwd);

  // Repo root validation + git init prompt is interactive — only when not in test mode.
  let repoRoot: string;
  try {
    repoRoot = validateRepoRoot(opts.cwd);
  } catch (e) {
    if (opts.answersOverride) throw e;
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }

  const dotR = resolveProjectResearcherDir(repoRoot);
  if (existsSync(dotR)) {
    if (!isAllTemplates(repoRoot)) {
      throw new Error(
        `${dotR} already contains user content; edit files manually or remove .researcher/ to re-onboard`
      );
    }
  } else {
    scaffoldTopicRepo({ repoRoot });
  }

  const onboardingMd = readFileSync(
    join(resolveResearcherHome(), 'methodology', 'onboarding.md'),
    'utf8'
  );
  const onboarding = parseOnboardingMd(onboardingMd);
  const pkg = resolvePackageRoot();
  const templateProjectYaml = readFileSync(join(pkg, 'templates/project.yaml'), 'utf8');
  const templateThesisMd = readFileSync(join(pkg, 'templates/thesis.md'), 'utf8');

  const runtime = new ClaudeCodeAdapter();

  // Test path: bypass TUI
  if (opts.answersOverride) {
    const result = await rewriteOrLog(
      runtime, repoRoot, onboardingMd, onboarding,
      opts.answersOverride, templateProjectYaml, templateThesisMd
    );
    if (!opts.autoAcceptDiff) return;
    const q1 = opts.answersOverride.find((a) => a.questionId === 'Q1');
    const topicOneline = q1?.kind === 'text' ? q1.text ?? '' : '';
    await writeOnboardArtifacts({
      repoRoot,
      projectYaml: result.projectYaml,
      thesisMd: result.thesisMd,
      slug: makeSlug(topicOneline),
    });
    return;
  }

  // Real path: render TUI
  await new Promise<void>((resolve) => {
    const ink = render(
      React.createElement(App, {
        questions: onboarding.questions,
        onAllAnswered: async (answers) => {
          const r = await rewriteOrLog(
            runtime, repoRoot, onboardingMd, onboarding,
            answers, templateProjectYaml, templateThesisMd
          );
          return {
            before: { projectYaml: templateProjectYaml, thesisMd: templateThesisMd },
            after: { projectYaml: r.projectYaml, thesisMd: r.thesisMd },
          };
        },
        onCommit: (rewritten, topicOneline) => {
          void (async () => {
            await writeOnboardArtifacts({
              repoRoot,
              projectYaml: rewritten.projectYaml,
              thesisMd: rewritten.thesisMd,
              slug: makeSlug(topicOneline),
            });
            ink.unmount();
            resolve();
            await maybeFirstPaper(repoRoot);
          })();
        },
        onAbort: () => {
          ink.unmount();
          resolve();
        },
      })
    );
  });
}

async function rewriteOrLog(
  runtime: ClaudeCodeAdapter,
  repoRoot: string,
  methodologyBody: string,
  onboarding: ReturnType<typeof parseOnboardingMd>,
  answers: SerializedAnswer[],
  templateProjectYaml: string,
  templateThesisMd: string
) {
  const userPrompt = composeUserPrompt({
    runtime, cwd: repoRoot, methodologyBody, onboarding, answers,
    templateProjectYaml, templateThesisMd,
  });
  const systemPrompt = composeSystemPrompt(methodologyBody);
  try {
    const r = await rewriteAnswers({
      runtime, cwd: repoRoot, methodologyBody, onboarding, answers,
      templateProjectYaml, templateThesisMd,
    });
    writeRunLog({
      repoRoot,
      answers,
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      response: r.rawOutput,
      result: { status: 'ok' },
    });
    return r;
  } catch (e) {
    const dump = `/tmp/researcher-onboard-${Date.now()}.json`;
    writeFileSync(dump, JSON.stringify(answers, null, 2));
    writeRunLog({
      repoRoot,
      answers,
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      response: '',
      result: { status: 'rewrite_failed', error: (e as Error).message },
    });
    throw new Error(`rewrite failed: ${(e as Error).message}; raw answers dumped to ${dump}`);
  }
}

function preFlight(cwd: string): void {
  // 1. claude binary
  const bin = process.env.RESEARCHER_CLAUDE_BIN ?? 'claude';
  try {
    execaSync(bin, ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(`claude CLI not found; install it or set RESEARCHER_CLAUDE_BIN`);
  }
  // 2. onboarding methodology installed
  const methPath = join(resolveResearcherHome(), 'methodology', 'onboarding.md');
  if (!existsSync(methPath)) {
    throw new Error(`onboarding methodology missing at ${methPath}; run \`researcher methodology install\``);
  }
}

async function maybeFirstPaper(repoRoot: string): Promise<void> {
  // Minimal stdin prompt — not part of TUI.
  process.stdout.write('\nfeed first arxiv id now? (paste id or press enter to skip): ');
  const id = await readStdinLine();
  if (!id) {
    process.stdout.write('\nonboarded. next: `researcher add <arxiv-id>`\n');
    return;
  }
  const { runAdd } = await import('./add.js');
  await runAdd({ input: id, cwd: repoRoot });
}

function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString();
      if (buf.includes('\n')) {
        process.stdin.removeListener('data', onData);
        resolve(buf.trim());
      }
    };
    process.stdin.on('data', onData);
  });
}
```

- [ ] **Step 4: Register the command in `src/cli.ts`**

After the `init` registration block, add:

```typescript
program
  .command('onboard')
  .description('Interactive TUI to scaffold and fill in a new topic')
  .action(async () => {
    const { runOnboard } = await import('./commands/onboard.js');
    await runOnboard({ cwd: process.cwd() });
  });
```

- [ ] **Step 5: Run tests; expect PASS**

Run: `npm test -- tests/commands/onboard.test.ts`
Expected: integration test passes.

- [ ] **Step 6: Run full test suite to ensure nothing else broke**

Run: `npm test`
Expected: all tests across the project pass.

- [ ] **Step 7: Commit**

```bash
git add src/commands/onboard.ts src/cli.ts tests/commands/onboard.test.ts
git commit -m "feat(onboard): runOnboard orchestration + CLI registration"
```

---

## Task 13: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Quick start section**

Replace the "Quick start" block in `README.md` (around line 35) with:

````markdown
## Quick start

In a fresh git repo for your research topic:

```sh
git init
researcher onboard
```

`onboard` walks you through 6 questions (2 required, 4 optional), uses
the agent runtime to rewrite your answers into `project.yaml` + `thesis.md`,
shows a diff for review, and creates the initial commit.

For power users who want to fill the templates manually:

```sh
git init
researcher init
# edit .researcher/project.yaml — research questions, sources, scope
# edit .researcher/thesis.md   — your working hypothesis
researcher add 2401.12345
```
````

- [ ] **Step 2: Add `onboard` to the Commands table**

Insert this row above the `researcher add` row:

```markdown
| `researcher onboard` | Interactive TUI to scaffold a topic from scratch |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document `researcher onboard` in quick start"
```

---

## Acceptance

After Task 13 completes, the following must hold:

1. `npm test` passes from a clean checkout.
2. `npm run lint` passes.
3. `npm run build` produces a working `dist/cli.js`.
4. `researcher methodology install` installs `onboarding.md` to `~/.researcher/methodology/`.
5. End-to-end manual smoke (the dogfood acceptance):
   - `mkdir ~/dev/github/research-agent-decision && cd $_ && git init`
   - `researcher onboard`
   - Answer Q1 (topic_oneline) and Q2 (research_questions); skip the rest
   - Confirm diff review shows rewritten content
   - Accept; verify single commit `researcher: onboard <slug>` on `main`
   - Skip first-paper prompt
   - `cat .researcher/project.yaml` shows real content for `meta.topic_oneline` and `research_questions`; other fields show template defaults with `# TODO: revisit ...` markers
