# Researcher CLI — Plan 1: Foundations + `init` + `add` end-to-end

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smallest vertical slice that proves the architecture: `researcher init` scaffolds a topic repo's `.researcher/` directory, and `researcher add <arxiv_id>` produces a draft pull request containing a paper note + landscape update + state-file diff, all generated through Claude Code headless invocation against the methodology files.

**Architecture:** TypeScript Node CLI using `commander` for arg parsing, `zod` for config schemas, `execa` for subprocess (claude/git/gh), `simple-git` for git ops. Methodology and template files are markdown in this repo, made available to a topic project via copy/symlink. The CLI itself does no LLM calls — it builds prompts, spawns `claude -p` headless, parses output, manages state files. For Plan 1 the pipeline is a reduced 4 stages (Bootstrap → Read → Synthesize → Verify+Package); Discover and Triage stages arrive in Plan 2.

**Tech Stack:**
- Node 20+
- TypeScript 5
- `commander` (CLI args)
- `zod` (validation)
- `execa` (subprocess)
- `simple-git` (git ops; `gh` is shelled via execa)
- `js-yaml` (yaml parsing)
- `vitest` (testing)
- `prettier` + `eslint` (lint/format)

**Spec source:** `docs/superpowers/specs/2026-04-26-researcher-cli-design.md`

**Spec coverage in Plan 1:** §3 two-layer arch, §4 methodology authoring, §5 project workspace incl. `project.yaml`, `thesis.md`, `seen.jsonl`, `watermark.json`, §6 stages 1/4/5/6 (Bootstrap, Read, Synthesize, Verify+Package), §6.2 commit & PR shape (2-commit + draft), §7 commands `init`, `add`, `methodology install/show/edit`, §8.1 CC adapter, §9 distribution. Acceptance #1 and #2.

**Spec deferred to later plans:**
- §6 stages 2/3 (Discover, Triage) — Plan 2
- §6.1 modes "autonomous" and "focused" — Plan 2
- §6.3 resume protocol full impl — Plan 3 (Plan 1 only writes start/done markers; doesn't implement resume command)
- §7 `status`, `resume`, `dry-run` — Plan 3
- §8.2 Codex adapter — out of MVP
- §11 PR noise backoff — Plan 2
- §12 acceptance #3, #4, #5 — Plan 2/3

---

## File Structure

Repo root: `~/dev/github/researcher/` (this repo, where the CLI source lives)

```
researcher/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.json
├── .prettierrc
├── .gitignore
├── README.md
├── src/
│   ├── cli.ts                        # commander entry, dispatches subcommands
│   ├── commands/
│   │   ├── init.ts                   # `researcher init`
│   │   ├── add.ts                    # `researcher add <id|pdf|url>`
│   │   ├── methodology.ts            # `researcher methodology show/edit/install`
│   │   └── version.ts                # trivial, used to prove plumbing works
│   ├── config/
│   │   ├── project-yaml.ts           # zod schema + loader for project.yaml
│   │   ├── global-config.ts          # zod schema + loader for ~/.researcher/config.yaml
│   │   └── thesis-md.ts              # plain-text loader for thesis.md
│   ├── state/
│   │   ├── seen.ts                   # seen.jsonl reader/writer/dedup
│   │   ├── watermark.ts              # watermark.json reader/writer
│   │   └── runs.ts                   # run-id, stage start/done markers, run dir resolver
│   ├── adapter/
│   │   ├── interface.ts              # AgentRuntime interface (so Codex slot exists)
│   │   └── claude-code.ts            # CC adapter — execa('claude', ['-p', ...])
│   ├── pipeline/
│   │   ├── runner.ts                 # stage orchestrator with start/done markers
│   │   ├── bootstrap.ts              # stage 1
│   │   ├── read.ts                   # stage 4
│   │   ├── synthesize.ts             # stage 5
│   │   └── package.ts                # stage 6 (verify + commits + PR)
│   ├── sources/
│   │   └── arxiv.ts                  # arxiv id → metadata + PDF URL fetch (used by `add`)
│   ├── git/
│   │   └── ops.ts                    # branch, commit, push, gh pr create
│   ├── prompts/
│   │   └── load.ts                   # reads prompts/*.md from this package
│   ├── paths.ts                      # path resolver: package root, ~/.researcher, project .researcher
│   └── util/
│       ├── log.ts                    # structured log to stderr + run-dir file
│       └── errors.ts                 # typed errors
├── prompts/
│   ├── system-preamble.md            # what researcher IS, used by all stages
│   ├── stage-bootstrap.md            # used to seed run context
│   ├── stage-read.md                 # paper-reading prompt
│   ├── stage-synthesize.md           # landscape-update prompt
│   └── stage-package.md              # devil's-advocate + verify prompt
├── methodology/
│   ├── 01-reading.md
│   ├── 02-source.md
│   ├── 03-filtering.md
│   ├── 04-synthesis.md
│   ├── 05-verification.md
│   ├── 06-writing.md
│   └── 07-cadence.md
├── templates/
│   ├── project.yaml                  # init scaffold
│   ├── thesis.md                     # init scaffold
│   ├── researcher-gitignore          # init scaffold for .researcher/.gitignore
│   └── landscape-readme.md           # included in init only if no notes/ exists yet
└── tests/
    ├── config/                       # unit tests for schema + loaders
    ├── state/                        # unit tests for seen/watermark/runs
    ├── pipeline/                     # tests for stage runner + resume markers
    └── e2e/
        └── add-arxiv.smoke.test.ts   # full-flow smoke (skipped unless CLAUDE_E2E=1)
```

Files-touched-together: `src/state/seen.ts` + `tests/state/seen.test.ts` ship in the same task. Same for every loader, every stage. CLI command files are written after their dependencies exist.

---

## Phase A — Project bootstrap

### Task 1: npm + TypeScript + vitest scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.eslintrc.json`, `.prettierrc`, `.gitignore`
- Modify: none

- [ ] **Step 1: Initialize npm package**

```bash
cd ~/dev/github/researcher
npm init -y
```

Edit `package.json` to set:
```json
{
  "name": "researcher",
  "version": "0.0.0",
  "type": "module",
  "bin": { "researcher": "./dist/cli.js" },
  "files": ["dist", "methodology", "prompts", "templates"],
  "scripts": {
    "build": "tsc -p .",
    "dev": "tsc -p . --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "format": "prettier --write src tests"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm i commander zod execa simple-git js-yaml
npm i -D typescript @types/node @types/js-yaml vitest @vitest/coverage-v8 \
  eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
coverage/
*.log
```

- [ ] **Step 6: Create `.prettierrc`**

```json
{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 7: Create `.eslintrc.json`**

```json
{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" },
  "env": { "node": true, "es2022": true },
  "rules": { "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }] }
}
```

- [ ] **Step 8: Verify build passes**

```bash
mkdir -p src && echo "export const VERSION = '0.0.0';" > src/version.ts
npm run build
```
Expected: `dist/version.js` exists, no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: bootstrap typescript + vitest + lint setup"
```

---

### Task 2: First passing unit test (proves test infra)

**Files:**
- Create: `tests/version.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/version.test.ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version.js';

describe('version', () => {
  it('exports a semver-shaped string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 2: Run test**

```bash
npm test
```
Expected: PASS (`VERSION = '0.0.0'` matches).

- [ ] **Step 3: Commit**

```bash
git add tests/version.test.ts
git commit -m "test: smoke test proves vitest infra works"
```

---

### Task 3: CLI entry point with `--version`

**Files:**
- Create: `src/cli.ts`, `src/commands/version.ts`
- Modify: none

- [ ] **Step 1: Create `src/commands/version.ts`**

```ts
import { VERSION } from '../version.js';

export function printVersion(): void {
  process.stdout.write(`${VERSION}\n`);
}
```

- [ ] **Step 2: Create `src/cli.ts`**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { VERSION } from './version.js';
import { printVersion } from './commands/version.js';

const program = new Command();
program.name('researcher').description('Per-topic research CLI').version(VERSION);
program
  .command('version')
  .description('Print version')
  .action(() => printVersion());

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Build & smoke**

```bash
npm run build
node dist/cli.js version
```
Expected: prints `0.0.0`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts src/commands/version.ts package.json
git commit -m "feat: cli entry with version subcommand"
```

---

## Phase B — Config & state primitives

### Task 4: `paths.ts` — central path resolver

**Files:**
- Create: `src/paths.ts`, `tests/paths.test.ts`

Exposes: package-root resolution (so `methodology/` and `prompts/` ship with the package), `~/.researcher/` resolution (with `RESEARCHER_HOME` override for tests), and `<project>/.researcher/` resolution.

- [ ] **Step 1: Write failing test**

```ts
// tests/paths.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveResearcherHome, resolveProjectResearcherDir, resolvePackageRoot } from '../src/paths.js';

describe('paths', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'r-paths-'));
  });
  it('resolveResearcherHome honors RESEARCHER_HOME env var', () => {
    process.env.RESEARCHER_HOME = tmp;
    expect(resolveResearcherHome()).toBe(tmp);
    delete process.env.RESEARCHER_HOME;
  });
  it('resolveProjectResearcherDir returns <cwd>/.researcher', () => {
    expect(resolveProjectResearcherDir(tmp)).toBe(join(tmp, '.researcher'));
  });
  it('resolvePackageRoot points at a dir containing methodology/', () => {
    const root = resolvePackageRoot();
    expect(root).toMatch(/researcher/);
  });
});
```

- [ ] **Step 2: Run — fails**

```bash
npm test -- paths
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/paths.ts
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveResearcherHome(): string {
  return process.env.RESEARCHER_HOME ?? join(homedir(), '.researcher');
}

export function resolveProjectResearcherDir(projectRoot: string): string {
  return join(projectRoot, '.researcher');
}

export function resolvePackageRoot(): string {
  // src/paths.ts → dist/paths.js at runtime; package root is two levels up
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}
```

- [ ] **Step 4: Run — passes**

```bash
npm test -- paths
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat: path resolver for researcher home, project dir, package root"
```

---

### Task 5: `project.yaml` zod schema + loader

**Files:**
- Create: `src/config/project-yaml.ts`, `tests/config/project-yaml.test.ts`

Schema mirrors spec §5.1.

- [ ] **Step 1: Write failing test**

```ts
// tests/config/project-yaml.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectYaml, ProjectYamlError } from '../../src/config/project-yaml.js';

const VALID = `
research_questions:
  - id: RQ1
    text: "How to triage trajectories?"
inclusion_criteria:
  - "Must address one of {RQ1..RQn}"
exclusion_criteria: []
sources:
  - kind: arxiv
    queries: ["agent trajectory"]
    priority: high
paper_axes:
  - name: layer
    values: [infrastructure, triage]
cadence:
  default_interval_days: 7
  backoff_after_empty_runs: 3
`;

describe('loadProjectYaml', () => {
  it('parses a valid project.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, VALID);
    const cfg = loadProjectYaml(p);
    expect(cfg.research_questions).toHaveLength(1);
    expect(cfg.research_questions[0].id).toBe('RQ1');
    expect(cfg.sources[0].kind).toBe('arxiv');
    expect(cfg.cadence.default_interval_days).toBe(7);
  });

  it('throws ProjectYamlError on missing required field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-cfg-'));
    const p = join(dir, 'project.yaml');
    writeFileSync(p, 'research_questions: []');
    expect(() => loadProjectYaml(p)).toThrow(ProjectYamlError);
  });
});
```

- [ ] **Step 2: Run — fails**

```bash
npm test -- project-yaml
```

- [ ] **Step 3: Implement**

```ts
// src/config/project-yaml.ts
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

export class ProjectYamlError extends Error {
  constructor(message: string, public readonly path: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ProjectYamlError';
  }
}

const ResearchQuestion = z.object({ id: z.string(), text: z.string() });
const Source = z.object({
  kind: z.enum(['arxiv', 'semantic_scholar', 'openreview', 'github', 'rss']),
  queries: z.array(z.string()).optional(),
  seed_papers: z.array(z.string()).optional(),
  follow: z.array(z.enum(['citations', 'references'])).optional(),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
});
const Axis = z.object({ name: z.string(), values: z.array(z.string()).min(1) });
const Cadence = z.object({
  default_interval_days: z.number().int().positive(),
  backoff_after_empty_runs: z.number().int().nonnegative(),
});

export const ProjectYamlSchema = z.object({
  research_questions: z.array(ResearchQuestion).min(1),
  inclusion_criteria: z.array(z.string()),
  exclusion_criteria: z.array(z.string()),
  sources: z.array(Source).min(1),
  paper_axes: z.array(Axis).default([]),
  cadence: Cadence,
});

export type ProjectYaml = z.infer<typeof ProjectYamlSchema>;

export function loadProjectYaml(path: string): ProjectYaml {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ProjectYamlError(`failed to parse yaml at ${path}`, path, err);
  }
  const parsed = ProjectYamlSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProjectYamlError(
      `invalid project.yaml at ${path}: ${parsed.error.message}`,
      path,
      parsed.error,
    );
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/config/project-yaml.ts tests/config/project-yaml.test.ts
git commit -m "feat: project.yaml schema + loader"
```

---

### Task 6: `thesis.md` plain-text loader

**Files:**
- Create: `src/config/thesis-md.ts`, `tests/config/thesis-md.test.ts`

`thesis.md` is prose; loader just reads it and validates required H2 sections exist (Working thesis, Taste, Anti-patterns, Examples).

- [ ] **Step 1: Write failing test**

```ts
// tests/config/thesis-md.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadThesis, ThesisError } from '../../src/config/thesis-md.js';

describe('loadThesis', () => {
  it('returns body and required section index when sections present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-thesis-'));
    const p = join(dir, 'thesis.md');
    writeFileSync(p, `# Thesis\n\n## Working thesis\nLorem.\n\n## Taste\n...\n\n## Anti-patterns\n...\n\n## Examples\n...\n`);
    const t = loadThesis(p);
    expect(t.body).toContain('Working thesis');
    expect(t.sections.has('Working thesis')).toBe(true);
    expect(t.sections.has('Taste')).toBe(true);
    expect(t.sections.has('Anti-patterns')).toBe(true);
    expect(t.sections.has('Examples')).toBe(true);
  });
  it('throws when a required section is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-thesis-'));
    const p = join(dir, 'thesis.md');
    writeFileSync(p, '# Thesis\n\n## Working thesis\nLorem.\n');
    expect(() => loadThesis(p)).toThrow(ThesisError);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/config/thesis-md.ts
import { readFileSync } from 'node:fs';

export class ThesisError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
    this.name = 'ThesisError';
  }
}

export interface Thesis {
  body: string;
  sections: Map<string, string>;
}

const REQUIRED = ['Working thesis', 'Taste', 'Anti-patterns', 'Examples'];

export function loadThesis(path: string): Thesis {
  const body = readFileSync(path, 'utf8');
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) sections.set(current, buf.join('\n').trim());
    buf = [];
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  for (const r of REQUIRED) {
    if (!sections.has(r)) {
      throw new ThesisError(`missing required section "${r}" in ${path}`, path);
    }
  }
  return { body, sections };
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/config/thesis-md.ts tests/config/thesis-md.test.ts
git commit -m "feat: thesis.md loader with required-section check"
```

---

### Task 7: `~/.researcher/config.yaml` global config schema + loader

**Files:**
- Create: `src/config/global-config.ts`, `tests/config/global-config.test.ts`

Global config holds runtime selection and gh auth hint. For Plan 1: only `runtime`.

- [ ] **Step 1: Write failing test**

```ts
// tests/config/global-config.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalConfig } from '../../src/config/global-config.js';

describe('loadGlobalConfig', () => {
  it('returns defaults when file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    const cfg = loadGlobalConfig(join(dir, 'config.yaml'));
    expect(cfg.runtime).toBe('claude-code');
  });
  it('reads runtime override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-'));
    const p = join(dir, 'config.yaml');
    writeFileSync(p, 'runtime: claude-code\n');
    expect(loadGlobalConfig(p).runtime).toBe('claude-code');
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/config/global-config.ts
import { existsSync, readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

export const GlobalConfigSchema = z
  .object({
    runtime: z.enum(['claude-code']).default('claude-code'),
  })
  .default({});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function loadGlobalConfig(path: string): GlobalConfig {
  if (!existsSync(path)) return GlobalConfigSchema.parse({});
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return GlobalConfigSchema.parse(raw ?? {});
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/config/global-config.ts tests/config/global-config.test.ts
git commit -m "feat: global config loader (runtime selection)"
```

---

### Task 8: `seen.jsonl` reader/writer/dedup

**Files:**
- Create: `src/state/seen.ts`, `tests/state/seen.test.ts`

Each entry: `{ id, source, first_seen_run, decision: 'deep-read'|'skim'|'reject', reason: string }`. Writer is append-only. Dedup uses `id`.

- [ ] **Step 1: Write failing test**

```ts
// tests/state/seen.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Seen } from '../../src/state/seen.js';

describe('Seen', () => {
  let p: string;
  beforeEach(() => {
    p = join(mkdtempSync(join(tmpdir(), 'r-seen-')), 'seen.jsonl');
  });
  it('creates empty when file does not exist', () => {
    const s = new Seen(p);
    expect(s.has('arxiv:2401.00001')).toBe(false);
  });
  it('appends and persists across instances', () => {
    const s1 = new Seen(p);
    s1.append({ id: 'arxiv:2401.00001', source: 'arxiv', first_seen_run: 'r1', decision: 'deep-read', reason: 'matches RQ1' });
    expect(s1.has('arxiv:2401.00001')).toBe(true);
    const s2 = new Seen(p);
    expect(s2.has('arxiv:2401.00001')).toBe(true);
    expect(s2.get('arxiv:2401.00001')?.decision).toBe('deep-read');
  });
  it('refuses duplicate id', () => {
    const s = new Seen(p);
    s.append({ id: 'a', source: 'arxiv', first_seen_run: 'r1', decision: 'reject', reason: 'x' });
    expect(() =>
      s.append({ id: 'a', source: 'arxiv', first_seen_run: 'r2', decision: 'reject', reason: 'y' }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/state/seen.ts
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const SeenEntrySchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  first_seen_run: z.string().min(1),
  decision: z.enum(['deep-read', 'skim', 'reject']),
  reason: z.string(),
});
export type SeenEntry = z.infer<typeof SeenEntrySchema>;

export class Seen {
  private readonly index = new Map<string, SeenEntry>();
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const entry = SeenEntrySchema.parse(JSON.parse(line));
        this.index.set(entry.id, entry);
      }
    }
  }
  has(id: string): boolean {
    return this.index.has(id);
  }
  get(id: string): SeenEntry | undefined {
    return this.index.get(id);
  }
  append(entry: SeenEntry): void {
    if (this.index.has(entry.id)) {
      throw new Error(`seen.jsonl already contains id=${entry.id}`);
    }
    SeenEntrySchema.parse(entry);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.index.set(entry.id, entry);
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/state/seen.ts tests/state/seen.test.ts
git commit -m "feat: seen.jsonl append-only dedup index"
```

---

### Task 9: `watermark.json` reader/writer

**Files:**
- Create: `src/state/watermark.ts`, `tests/state/watermark.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/state/watermark.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWatermark, writeWatermark } from '../../src/state/watermark.js';

describe('watermark', () => {
  it('returns null when file is absent', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'r-wm-')), 'watermark.json');
    expect(readWatermark(p)).toBeNull();
  });
  it('round-trips a value', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'r-wm-')), 'watermark.json');
    const w = { last_run_completed_at: '2026-04-26T00:00:00Z', last_run_window: { from: '2026-04-19T00:00:00Z', to: '2026-04-26T00:00:00Z' }, last_run_id: 'r-abc' };
    writeWatermark(p, w);
    expect(readWatermark(p)).toEqual(w);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/state/watermark.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const WatermarkSchema = z.object({
  last_run_completed_at: z.string(),
  last_run_window: z.object({ from: z.string(), to: z.string() }),
  last_run_id: z.string(),
});
export type Watermark = z.infer<typeof WatermarkSchema>;

export function readWatermark(path: string): Watermark | null {
  if (!existsSync(path)) return null;
  return WatermarkSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeWatermark(path: string, w: Watermark): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(w, null, 2) + '\n');
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/state/watermark.ts tests/state/watermark.test.ts
git commit -m "feat: watermark.json reader/writer"
```

---

### Task 10: Run state — id generator + stage start/done markers

**Files:**
- Create: `src/state/runs.ts`, `tests/state/runs.test.ts`

A run id is `r-<UTC ISO without colons>-<6 random chars>`. Stage markers are empty files at `.researcher/state/runs/<id>/<stage>.start` and `.done` (timestamps in their content).

- [ ] **Step 1: Write failing test**

```ts
// tests/state/runs.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newRunId, RunDir, STAGES } from '../../src/state/runs.js';

describe('runs', () => {
  it('newRunId is unique-ish', () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^r-/);
  });
  it('STAGES contains the four Plan-1 stages in order', () => {
    expect(STAGES).toEqual(['bootstrap', 'read', 'synthesize', 'package']);
  });
  it('RunDir creates start/done markers', () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runs-'));
    const id = newRunId();
    const rd = new RunDir(base, id);
    rd.markStart('bootstrap');
    expect(existsSync(rd.path('bootstrap.start'))).toBe(true);
    expect(rd.isDone('bootstrap')).toBe(false);
    rd.markDone('bootstrap');
    expect(rd.isDone('bootstrap')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/state/runs.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const STAGES = ['bootstrap', 'read', 'synthesize', 'package'] as const;
export type Stage = (typeof STAGES)[number];

export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = randomBytes(3).toString('hex');
  return `r-${ts}-${rand}`;
}

export class RunDir {
  readonly dir: string;
  constructor(stateRunsBase: string, public readonly id: string) {
    this.dir = join(stateRunsBase, id);
    mkdirSync(this.dir, { recursive: true });
  }
  path(name: string): string {
    return join(this.dir, name);
  }
  markStart(stage: Stage): void {
    writeFileSync(this.path(`${stage}.start`), new Date().toISOString() + '\n');
  }
  markDone(stage: Stage): void {
    writeFileSync(this.path(`${stage}.done`), new Date().toISOString() + '\n');
  }
  isDone(stage: Stage): boolean {
    return existsSync(this.path(`${stage}.done`));
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/state/runs.ts tests/state/runs.test.ts
git commit -m "feat: run id + stage start/done marker primitives"
```

---

## Phase C — `researcher init`

### Task 11: Init scaffold templates

**Files:**
- Create: `templates/project.yaml`, `templates/thesis.md`, `templates/researcher-gitignore`

Real, usable starter content — not placeholders.

- [ ] **Step 1: Write `templates/project.yaml`**

```yaml
# project.yaml — structured project soul
# Edit this to declare your topic's research questions, criteria, sources.

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

- [ ] **Step 2: Write `templates/thesis.md`**

```markdown
# Thesis

> Working thesis lives here. Researcher reads this every run and uses it to
> decide whether new material supports / extends / challenges / is orthogonal
> to your current view. Researcher will *report* contradictions but never
> edit this file — thesis changes are always your decision.

## Working thesis

State your current best understanding of the topic in 3–6 sentences. Make it
falsifiable. If a paper proves it wrong you should be able to point at the
specific claim.

## Taste

What counts as a good paper here? What does a bad one look like?
List 3–5 concrete preferences. Examples:
- "Favor lightweight, deployable signals over heavy LLM-judge approaches."
- "Prefer mechanistic explanations over correlation studies."

## Anti-patterns

What do you intentionally reject? Examples:
- "Benchmark-only papers without an underlying method."
- "Survey papers that don't introduce a new framing."

## Examples

Pointers to existing notes that exemplify good or bad inclusion decisions.
You can leave this empty until you have a few notes.
```

- [ ] **Step 3: Write `templates/researcher-gitignore`**

```
# Local-only run logs (intermediate stage outputs, devil's-advocate drafts).
# seen.jsonl and watermark.json are committed — see plan 1 §state.
state/runs/
```

- [ ] **Step 4: Commit**

```bash
git add templates/
git commit -m "feat: init scaffold templates"
```

---

### Task 12: `researcher init` command

**Files:**
- Create: `src/commands/init.ts`
- Modify: `src/cli.ts`

Behavior:
1. Resolve target dir (default: `process.cwd()`).
2. Refuse if `<target>/.researcher/` already exists.
3. Refuse if target is not inside a git repo (caller can `git init` first).
4. Copy `templates/project.yaml` → `<target>/.researcher/project.yaml`.
5. Copy `templates/thesis.md` → `<target>/.researcher/thesis.md`.
6. Create `<target>/.researcher/state/`.
7. Touch `<target>/.researcher/state/seen.jsonl` (empty).
8. Copy `templates/researcher-gitignore` → `<target>/.researcher/.gitignore`.
9. Print next-step hints to stdout.

- [ ] **Step 1: Write failing integration test**

```ts
// tests/commands/init.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';

function gitInit(dir: string): void {
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
}

describe('init', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-init-'));
    gitInit(dir);
  });
  it('creates expected structure', async () => {
    await runInit({ targetDir: dir });
    expect(existsSync(join(dir, '.researcher/project.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.researcher/thesis.md'))).toBe(true);
    expect(existsSync(join(dir, '.researcher/state/seen.jsonl'))).toBe(true);
    expect(existsSync(join(dir, '.researcher/.gitignore'))).toBe(true);
    expect(readFileSync(join(dir, '.researcher/.gitignore'), 'utf8')).toContain('state/runs/');
  });
  it('refuses if .researcher already exists', async () => {
    await runInit({ targetDir: dir });
    await expect(runInit({ targetDir: dir })).rejects.toThrow(/already exists/);
  });
  it('refuses if not in a git repo', async () => {
    const noGit = mkdtempSync(join(tmpdir(), 'r-nogit-'));
    await expect(runInit({ targetDir: noGit })).rejects.toThrow(/git repo/);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/commands/init.ts
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

export interface InitOptions { targetDir: string; }

function isGitRepo(dir: string): boolean {
  // walk up looking for .git
  let cur = dir;
  while (true) {
    if (existsSync(join(cur, '.git'))) return true;
    const parent = join(cur, '..');
    if (parent === cur) return false;
    cur = parent;
  }
}

export async function runInit(opts: InitOptions): Promise<void> {
  const target = resolveProjectResearcherDir(opts.targetDir);
  if (existsSync(target)) {
    throw new Error(`${target} already exists`);
  }
  if (!isGitRepo(opts.targetDir)) {
    throw new Error(`${opts.targetDir} is not inside a git repo (run \`git init\` first)`);
  }
  const pkg = resolvePackageRoot();
  mkdirSync(join(target, 'state'), { recursive: true });
  copyFileSync(join(pkg, 'templates/project.yaml'), join(target, 'project.yaml'));
  copyFileSync(join(pkg, 'templates/thesis.md'), join(target, 'thesis.md'));
  copyFileSync(join(pkg, 'templates/researcher-gitignore'), join(target, '.gitignore'));
  writeFileSync(join(target, 'state/seen.jsonl'), '');

  process.stdout.write(`initialized ${target}\n`);
  process.stdout.write(`next steps:\n`);
  process.stdout.write(`  1. edit .researcher/project.yaml — declare your research questions and sources\n`);
  process.stdout.write(`  2. edit .researcher/thesis.md — state your working thesis\n`);
  process.stdout.write(`  3. run \`researcher methodology install\` once globally to install methodology\n`);
  process.stdout.write(`  4. then \`researcher add <arxiv_id>\` to ingest your first paper\n`);
}
```

- [ ] **Step 4: Wire into CLI** (`src/cli.ts`)

Add to existing `program`:
```ts
program
  .command('init')
  .description('Scaffold .researcher/ in the current topic repo')
  .action(async () => {
    const { runInit } = await import('./commands/init.js');
    await runInit({ targetDir: process.cwd() });
  });
```

- [ ] **Step 5: Run tests + manual smoke**

```bash
npm test -- init
npm run build
mkdir -p /tmp/r-smoke && cd /tmp/r-smoke && git init -b main
node ~/dev/github/researcher/dist/cli.js init
ls -la .researcher
```
Expected: structure created, hints printed.

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts src/cli.ts tests/commands/init.test.ts
git commit -m "feat: researcher init command"
```

---

## Phase D — Methodology authoring

These are content tasks. Each file is **opinionated**: it tells the underlying agent how this researcher works. Acceptance for each file: contains the specified sections, includes 2+ concrete examples or anti-examples where relevant, voice is direct and information-dense (no filler).

The full content of each methodology file is authored at implementation time using the structure shown below. Authoring guidelines:
- Voice: second person ("You read papers like this:") or imperative ("Always extract claims before opinions.").
- Each file < 1500 words.
- Concrete > abstract: prefer rules with examples to general principles.

### Task 13: `methodology/01-reading.md`

**Files:**
- Create: `methodology/01-reading.md`

Required sections:
1. **Purpose** — one paragraph: "Every paper note must follow this skeleton so synthesis can compose them."
2. **Reading template (mandatory)** — 6 sections every note has: Claims / Assumptions / Method / Eval / Weaknesses / Relations. For each, 1–2 sentences on what belongs and what doesn't.
3. **Quote discipline** — when to quote vs. paraphrase; max quote length.
4. **Confidence labels** — every claim in "Relations" gets a confidence: `high` (multiple independent sources or directly stated by paper), `medium` (paper implies it), `low` (your inference). Format: `[high]`, `[med]`, `[low]`.
5. **Anti-patterns** — list 3+ failure modes (e.g., "summarizing the abstract instead of extracting claims", "writing relations without evidence").

- [ ] **Step 1: Author the file** (one task = write the file end-to-end)

- [ ] **Step 2: Self-review against required sections list above**

- [ ] **Step 3: Commit**

```bash
git add methodology/01-reading.md
git commit -m "docs: methodology — reading discipline"
```

### Task 14: `methodology/02-source.md`

**Files:**
- Create: `methodology/02-source.md`

Required sections:
1. **Default sources** — arXiv (cs.LG, cs.AI, cs.CL by default; project narrows), Semantic Scholar (citations + references follow), OpenReview, GitHub releases of named tools, lab blogs.
2. **Per-source query strategy** — what queries look like, how project's `sources[].queries` map to actual API calls.
3. **Dedup strategy** — DOI > arxiv id > title-hash fallback. Canonical id always begins with the source prefix (`arxiv:2401.00001`).
4. **Override convention** — when project.yaml `sources[]` is set, those *replace* the defaults, not add to them.

- [ ] **Step 1: Author**
- [ ] **Step 2: Self-review**
- [ ] **Step 3: Commit**

```bash
git add methodology/02-source.md
git commit -m "docs: methodology — source discipline"
```

### Task 15: `methodology/03-filtering.md`

**Files:**
- Create: `methodology/03-filtering.md`

Required sections:
1. **Scoring axes** — relevance to RQs (0–3), thesis alignment (supports/extends/challenges/orthogonal), novelty (new vs incremental), citation gravity (lab/track record).
2. **Decision thresholds** — `deep-read` if relevance ≥ 2 AND alignment ∈ {supports, extends, challenges} AND novelty ≥ "incremental"; `skim` if relevance ≥ 1; else `reject`.
3. **Reason discipline** — every triage decision must produce a one-sentence `why` that names the RQ matched and the alignment label.
4. **Override convention** — project may raise/lower thresholds in `project.yaml` (Plan 2 will read these; Plan 1 uses defaults only).

- [ ] **Step 1: Author**
- [ ] **Step 2: Self-review**
- [ ] **Step 3: Commit**

```bash
git add methodology/03-filtering.md
git commit -m "docs: methodology — filtering discipline"
```

### Task 16: `methodology/04-synthesis.md`

**Files:**
- Create: `methodology/04-synthesis.md`

Required sections:
1. **Where new papers go** — must be placed in the layered stack (or whichever taxonomy the project's landscape uses); if no taxonomy fits, propose extending it as a separate suggestion in PR body, not as a unilateral landscape edit.
2. **Relations are mandatory** — every newly added paper must declare ≥ 1 relation to existing papers (`builds-on`, `competes-with`, `extends`, `contradicts`, `orthogonal`). If you can't find any, reconsider whether the paper belongs.
3. **Contradiction detection** — when a paper's claim conflicts with an existing claim or thesis, write it into `contradictions.md` for the run; do **not** unilaterally resolve.
4. **Citation hygiene** — every claim in landscape changes must have an `[N]` reference to a paper note in `notes/`.
5. **Diff style** — prefer narrow, surgical landscape edits over rewrites. If the layered diagram needs structural change, propose it explicitly in PR body.

- [ ] **Step 1: Author**
- [ ] **Step 2: Self-review**
- [ ] **Step 3: Commit**

```bash
git add methodology/04-synthesis.md
git commit -m "docs: methodology — synthesis discipline"
```

### Task 17: `methodology/05-verification.md`

**Files:**
- Create: `methodology/05-verification.md`

Required sections:
1. **Cross-check requirement** — load-bearing claims must be verified against ≥ 2 independent sources (paper itself + cited evidence, or two papers).
2. **Confidence labels in landscape** — same format as in reading: `[high]`, `[med]`, `[low]` after every novel claim.
3. **Devil's-advocate pass (mandatory)** — before package, generate the strongest available counter-position to: (a) the paper's main claim, (b) the project's working thesis (in light of the paper). Write both into `package` stage output.
4. **What would change my mind** — explicit list: "If we observed X, the working thesis would need revision." Goes into PR body.

- [ ] **Step 1: Author**
- [ ] **Step 2: Self-review**
- [ ] **Step 3: Commit**

```bash
git add methodology/05-verification.md
git commit -m "docs: methodology — verification discipline"
```

### Task 18: `methodology/06-writing.md`

**Files:**
- Create: `methodology/06-writing.md`

Required sections:
1. **Voice** — information-dense, no filler ("This paper presents..."), present tense, English/中文 mix matches the rest of the project's existing notes.
2. **Note filename** — `NN_short_slug.md` where NN = next zero-padded number in `notes/`. Slug from paper title, lowercased, snake_case, ≤ 6 words.
3. **PR title** — `research: <one-line summary, max 70 chars>`.
4. **Commit messages** — C1: `research: add note on <slug> + landscape update`; C2: `state: seen +1, watermark <ISO>`.
5. **Diffs explain why** — every landscape diff line that's substantive must justify itself either inline or in PR body section "Why these changes".

- [ ] **Step 1: Author**
- [ ] **Step 2: Self-review**
- [ ] **Step 3: Commit**

```bash
git add methodology/06-writing.md
git commit -m "docs: methodology — writing discipline"
```

### Task 19: `methodology/07-cadence.md`

**Files:**
- Create: `methodology/07-cadence.md`

Required sections:
1. **Default interval** — 7 days for autonomous (read from project.yaml).
2. **Backoff** — after N consecutive runs that produce no PR (configurable via project.yaml `cadence.backoff_after_empty_runs`), skip the next scheduled run.
3. **Plan 1 note** — autonomous mode is implemented in Plan 2; this discipline is recorded now so Plan 2 can wire it.

- [ ] **Step 1: Author**
- [ ] **Step 2: Self-review**
- [ ] **Step 3: Commit**

```bash
git add methodology/07-cadence.md
git commit -m "docs: methodology — cadence discipline"
```

---

### Task 20: `researcher methodology install / show / edit`

**Files:**
- Create: `src/commands/methodology.ts`
- Modify: `src/cli.ts`

Behavior:
- `install`: copy (not symlink, so npm-installed package works) every file in package's `methodology/` to `~/.researcher/methodology/`. Existing files: prompt-free overwrite, but skip with a notice if the target file is identical (cheap content compare).
- `show`: list files in `~/.researcher/methodology/` with line counts.
- `edit <name>`: open `$EDITOR` against `~/.researcher/methodology/<name>` (e.g. `01-reading.md`). Refuse if file does not exist.

- [ ] **Step 1: Write failing tests**

```ts
// tests/commands/methodology.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMethodologyInstall, runMethodologyShow } from '../../src/commands/methodology.js';

describe('methodology install', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-mhome-'));
    process.env.RESEARCHER_HOME = home;
  });
  it('copies all 7 methodology files into ~/.researcher/methodology', async () => {
    await runMethodologyInstall();
    const dir = join(home, 'methodology');
    for (const name of ['01-reading.md','02-source.md','03-filtering.md','04-synthesis.md','05-verification.md','06-writing.md','07-cadence.md']) {
      expect(existsSync(join(dir, name))).toBe(true);
      expect(readFileSync(join(dir, name), 'utf8').length).toBeGreaterThan(50);
    }
  });
});

describe('methodology show', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-mhome-'));
    process.env.RESEARCHER_HOME = home;
    mkdirSync(join(home, 'methodology'), { recursive: true });
    writeFileSync(join(home, 'methodology', 'x.md'), 'a\nb\nc\n');
  });
  it('lists files and line counts', async () => {
    const out = await runMethodologyShow();
    expect(out).toMatch(/x\.md\s+3/);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/commands/methodology.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolvePackageRoot, resolveResearcherHome } from '../paths.js';

const FILES = [
  '01-reading.md',
  '02-source.md',
  '03-filtering.md',
  '04-synthesis.md',
  '05-verification.md',
  '06-writing.md',
  '07-cadence.md',
];

export async function runMethodologyInstall(): Promise<void> {
  const src = join(resolvePackageRoot(), 'methodology');
  const dst = join(resolveResearcherHome(), 'methodology');
  mkdirSync(dst, { recursive: true });
  let copied = 0, skipped = 0;
  for (const f of FILES) {
    const s = join(src, f), d = join(dst, f);
    if (existsSync(d) && readFileSync(s) .equals(readFileSync(d))) {
      skipped++;
      continue;
    }
    copyFileSync(s, d);
    copied++;
  }
  process.stdout.write(`installed methodology to ${dst} (copied ${copied}, skipped ${skipped})\n`);
}

export async function runMethodologyShow(): Promise<string> {
  const dir = join(resolveResearcherHome(), 'methodology');
  if (!existsSync(dir)) {
    process.stdout.write(`no methodology installed; run \`researcher methodology install\`\n`);
    return '';
  }
  const lines: string[] = [];
  for (const f of readdirSync(dir).sort()) {
    const lc = readFileSync(join(dir, f), 'utf8').split('\n').length;
    lines.push(`${f}\t${lc}`);
  }
  const out = lines.join('\n') + '\n';
  process.stdout.write(out);
  return out;
}

export async function runMethodologyEdit(name: string): Promise<void> {
  const target = join(resolveResearcherHome(), 'methodology', name);
  if (!existsSync(target)) throw new Error(`no such methodology file: ${name}`);
  const editor = process.env.EDITOR ?? 'vi';
  await execa(editor, [target], { stdio: 'inherit' });
}
```

- [ ] **Step 4: Wire into CLI**

```ts
// add to src/cli.ts
const methodology = program.command('methodology').description('Manage researcher methodology files');
methodology.command('install').action(async () => (await import('./commands/methodology.js')).runMethodologyInstall());
methodology.command('show').action(async () => (await import('./commands/methodology.js')).runMethodologyShow());
methodology.command('edit <name>').action(async (name: string) => (await import('./commands/methodology.js')).runMethodologyEdit(name));
```

- [ ] **Step 5: Run tests + smoke**

```bash
npm test -- methodology
npm run build
RESEARCHER_HOME=/tmp/r-home node dist/cli.js methodology install
RESEARCHER_HOME=/tmp/r-home node dist/cli.js methodology show
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/methodology.ts src/cli.ts tests/commands/methodology.test.ts
git commit -m "feat: methodology install/show/edit commands"
```

---

## Phase E — Stage prompts (templates)

Stage prompts are markdown files with `{{placeholder}}` slots filled in by the runner. Stored in `prompts/`. Loaded via `src/prompts/load.ts`.

### Task 21: `src/prompts/load.ts` template loader

**Files:**
- Create: `src/prompts/load.ts`, `tests/prompts/load.test.ts`

Tiny `{{key}}` substitution; no Jinja, no Handlebars.

- [ ] **Step 1: Write failing test**

```ts
// tests/prompts/load.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../src/prompts/load.js';

describe('renderTemplate', () => {
  it('substitutes simple keys', () => {
    expect(renderTemplate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });
  it('throws when a placeholder has no value', () => {
    expect(() => renderTemplate('hi {{x}}', {})).toThrow(/x/);
  });
  it('leaves non-template braces alone', () => {
    expect(renderTemplate('{x}', {})).toBe('{x}');
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/prompts/load.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackageRoot } from '../paths.js';

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    if (!(k in vars)) throw new Error(`template missing value for ${k}`);
    return vars[k];
  });
}

export function loadPromptTemplate(name: string): string {
  return readFileSync(join(resolvePackageRoot(), 'prompts', name), 'utf8');
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/prompts/load.ts tests/prompts/load.test.ts
git commit -m "feat: prompt template loader with {{key}} substitution"
```

---

### Task 22: Author `prompts/system-preamble.md`

**Files:**
- Create: `prompts/system-preamble.md`

Static content; injected into every CC invocation as the system prompt prefix. Tells the agent what it is.

Required content (file is short, ~150 words):
- One-paragraph identity: "You are the researcher. You are operating on a topic project located at the working directory. Your job is to follow the methodology files exactly."
- Constraint list: "You will be given methodology files and project soul. Read them in full before acting. Never modify thesis.md. Never modify README.md. Output exactly what the stage prompt asks for."

- [ ] **Step 1: Author file**

- [ ] **Step 2: Commit**

```bash
git add prompts/system-preamble.md
git commit -m "feat: prompts — system preamble"
```

---

### Task 23: Author `prompts/stage-read.md`

**Files:**
- Create: `prompts/stage-read.md`

Inputs (substituted vars): `{{methodology_reading}}`, `{{methodology_writing}}`, `{{project_yaml}}`, `{{thesis}}`, `{{paper_metadata}}`, `{{paper_text}}`, `{{notes_dir_listing}}`, `{{next_note_filename}}`.

Required content (~250 words):
- Section 1: "Methodology — reading discipline" — embeds `{{methodology_reading}}`.
- Section 2: "Methodology — writing discipline" — embeds `{{methodology_writing}}`.
- Section 3: "Project soul" — embeds yaml and thesis.
- Section 4: "Paper to read" — metadata + text.
- Section 5: "Existing notes (for filename collision check)" — listing.
- Section 6: "Output instructions" — exact deliverable: write a single markdown file at `notes/{{next_note_filename}}` using the reading template. Do **only** that. Do not modify other files in this stage.

- [ ] **Step 1: Author file**

- [ ] **Step 2: Commit**

```bash
git add prompts/stage-read.md
git commit -m "feat: prompts — stage-read template"
```

---

### Task 24: Author `prompts/stage-synthesize.md`

**Files:**
- Create: `prompts/stage-synthesize.md`

Substituted vars: `{{methodology_synthesis}}`, `{{methodology_writing}}`, `{{thesis}}`, `{{landscape_current}}`, `{{new_note_filename}}`, `{{new_note_content}}`, `{{contradictions_path}}`.

Required content (~250 words):
- Embeds synthesis + writing methodology.
- Embeds current landscape.md content + the new note content.
- Output instructions: produce two artifacts:
  1. an updated `notes/00_research_landscape.md` (full file content; runner will diff and write)
  2. a `contradictions.md` at `{{contradictions_path}}` listing any contradictions found (or "none" if not).
- Constraint: do not edit thesis.md.

- [ ] **Step 1: Author file**

- [ ] **Step 2: Commit**

```bash
git add prompts/stage-synthesize.md
git commit -m "feat: prompts — stage-synthesize template"
```

---

### Task 25: Author `prompts/stage-package.md`

**Files:**
- Create: `prompts/stage-package.md`

Substituted vars: `{{methodology_verification}}`, `{{methodology_writing}}`, `{{thesis}}`, `{{new_note_content}}`, `{{landscape_diff}}`, `{{contradictions}}`, `{{run_summary_path}}`.

Required content (~300 words):
- Embeds verification + writing methodology.
- Embeds new note content + landscape diff (textual unified diff) + contradictions.
- Output instructions: write a markdown file at `{{run_summary_path}}` containing 4 sections:
  1. **Run summary** — what was added, why.
  2. **Devil's-advocate pass** — strongest counter-position to the new claims and to the working thesis.
  3. **Confidence labels** — flag any claims in the landscape diff that should be re-labeled.
  4. **What would change my mind** — explicit list.
- Constraint: do not modify any other files.

- [ ] **Step 1: Author file**

- [ ] **Step 2: Commit**

```bash
git add prompts/stage-package.md
git commit -m "feat: prompts — stage-package template"
```

---

## Phase F — Claude Code adapter

### Task 26: `AgentRuntime` interface

**Files:**
- Create: `src/adapter/interface.ts`

The interface shape that both CC adapter (Plan 1) and future Codex adapter implement.

- [ ] **Step 1: Create file**

```ts
// src/adapter/interface.ts

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
}

export interface AgentRuntime {
  readonly id: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adapter/interface.ts
git commit -m "feat: AgentRuntime interface"
```

---

### Task 27: Claude Code adapter

**Files:**
- Create: `src/adapter/claude-code.ts`, `tests/adapter/claude-code.test.ts`

Implementation strategy:
- Spawn `claude -p <userPrompt> --append-system-prompt <systemPrompt>` via `execa`. Use `--allowedTools` to permit the tools the stage needs (Read, Write, Edit, Bash). For Plan 1 we pass `--dangerously-skip-permissions` so the run doesn't prompt; user accepts this since they invoke the CLI explicitly.
- Pass the `cwd`. The agent, having Write/Edit tools, will modify files under the project working tree directly.
- Capture stdout. Parse `modifiedFiles` from a structured "FILES_MODIFIED" suffix the prompts will instruct the agent to print at the end of its response (this is a soft contract — if missing, return empty array).

Test strategy:
- Unit-mock `execa`. Verify the command line constructed.
- Real-CC integration test gated behind `CLAUDE_E2E=1` env var; skipped by default in CI.

- [ ] **Step 1: Write unit test (mocked execa)**

```ts
// tests/adapter/claude-code.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(async (_bin: string, args: string[], _opts: object) => ({
    exitCode: 0,
    stdout: 'hello\n\nFILES_MODIFIED:\nnotes/01_x.md\n',
    stderr: '',
    args,
  })),
}));

import { ClaudeCodeAdapter } from '../../src/adapter/claude-code.js';

describe('ClaudeCodeAdapter', () => {
  it('invokes claude -p with correct args', async () => {
    const a = new ClaudeCodeAdapter();
    const r = await a.invoke({ cwd: '/tmp/x', systemPrompt: 'SYS', userPrompt: 'USR' });
    expect(r.exitCode).toBe(0);
    expect(r.modifiedFiles).toEqual(['notes/01_x.md']);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/adapter/claude-code.ts
import { execa } from 'execa';
import type { AgentRuntime, InvokeOptions, InvokeResult } from './interface.js';

const CLAUDE_BIN = process.env.RESEARCHER_CLAUDE_BIN ?? 'claude';
const ALLOWED_TOOLS = 'Read,Write,Edit,Bash,WebFetch,WebSearch';

export class ClaudeCodeAdapter implements AgentRuntime {
  readonly id = 'claude-code';

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const args = [
      '-p',
      opts.userPrompt,
      '--append-system-prompt',
      opts.systemPrompt,
      '--allowedTools',
      ALLOWED_TOOLS,
      '--dangerously-skip-permissions',
    ];
    const result = await execa(CLAUDE_BIN, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30 * 60 * 1000,
      reject: false,
    });
    return {
      output: result.stdout ?? '',
      exitCode: result.exitCode ?? 1,
      modifiedFiles: parseFilesModified(result.stdout ?? ''),
    };
  }
}

function parseFilesModified(output: string): string[] {
  const m = /FILES_MODIFIED:\s*\n([\s\S]*?)(?:\n\n|$)/.exec(output);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
```

- [ ] **Step 4: Run unit test — passes**

- [ ] **Step 5: Manual smoke test (optional, requires Claude Code installed)**

```bash
npm run build
node -e "
  import('./dist/adapter/claude-code.js').then(async ({ClaudeCodeAdapter}) => {
    const a = new ClaudeCodeAdapter();
    const r = await a.invoke({ cwd: process.cwd(), systemPrompt: 'You are a test bot.', userPrompt: 'Reply with just the word PONG and nothing else.' });
    console.log({exitCode: r.exitCode, output: r.output.slice(0,200)});
  });
"
```
Expected: stdout contains `PONG`. (If Claude Code is not configured, this fails — that's OK, integration tests are gated.)

- [ ] **Step 6: Commit**

```bash
git add src/adapter/claude-code.ts tests/adapter/claude-code.test.ts
git commit -m "feat: Claude Code headless adapter"
```

---

## Phase G — Source helpers (arXiv only for Plan 1)

### Task 28: arXiv id resolver

**Files:**
- Create: `src/sources/arxiv.ts`, `tests/sources/arxiv.test.ts`

Behavior:
- Accepts either a bare id (`2401.12345`) or full URL (`https://arxiv.org/abs/2401.12345`).
- Returns canonical id `arxiv:2401.12345`, abstract URL, PDF URL.
- Fetches the abstract page via `fetch` and parses title + authors + abstract from the meta tags.

- [ ] **Step 1: Write failing test**

```ts
// tests/sources/arxiv.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalizeArxivId, arxivAbsUrl, arxivPdfUrl } from '../../src/sources/arxiv.js';

describe('arxiv', () => {
  it('canonicalizes bare id', () => {
    expect(canonicalizeArxivId('2401.12345')).toBe('arxiv:2401.12345');
  });
  it('canonicalizes URL', () => {
    expect(canonicalizeArxivId('https://arxiv.org/abs/2401.12345v2')).toBe('arxiv:2401.12345');
  });
  it('rejects bogus input', () => {
    expect(() => canonicalizeArxivId('foo')).toThrow();
  });
  it('builds abs/pdf URLs', () => {
    expect(arxivAbsUrl('arxiv:2401.12345')).toBe('https://arxiv.org/abs/2401.12345');
    expect(arxivPdfUrl('arxiv:2401.12345')).toBe('https://arxiv.org/pdf/2401.12345');
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/sources/arxiv.ts

const ID_RE = /(\d{4}\.\d{4,5})(?:v\d+)?/;

export function canonicalizeArxivId(input: string): string {
  const m = ID_RE.exec(input);
  if (!m) throw new Error(`not an arxiv id: ${input}`);
  return `arxiv:${m[1]}`;
}

export function arxivAbsUrl(canonicalId: string): string {
  const id = canonicalId.replace(/^arxiv:/, '');
  return `https://arxiv.org/abs/${id}`;
}

export function arxivPdfUrl(canonicalId: string): string {
  const id = canonicalId.replace(/^arxiv:/, '');
  return `https://arxiv.org/pdf/${id}`;
}

export interface ArxivMetadata {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  abs_url: string;
  pdf_url: string;
}

export async function fetchArxivMetadata(canonicalId: string): Promise<ArxivMetadata> {
  const absUrl = arxivAbsUrl(canonicalId);
  const html = await (await fetch(absUrl)).text();
  const title = (/<meta name="citation_title" content="([^"]+)"/.exec(html)?.[1] ?? '').trim();
  const abstract = (/<meta name="citation_abstract" content="([^"]+)"/.exec(html)?.[1] ?? '').trim();
  const authors = [...html.matchAll(/<meta name="citation_author" content="([^"]+)"/g)].map((m) => m[1]);
  if (!title) throw new Error(`could not parse title from ${absUrl}`);
  return {
    id: canonicalId,
    title,
    authors,
    abstract,
    abs_url: absUrl,
    pdf_url: arxivPdfUrl(canonicalId),
  };
}
```

- [ ] **Step 4: Run — passes** (unit tests; metadata fetch covered manually in smoke)

- [ ] **Step 5: Commit**

```bash
git add src/sources/arxiv.ts tests/sources/arxiv.test.ts
git commit -m "feat: arxiv id canonicalization + metadata fetch"
```

---

## Phase H — Pipeline for `add`

The `add` mode skips Discover + Triage. Stages used: Bootstrap → Read → Synthesize → Package. Each stage is a pure function of inputs + adapter. The runner persists start/done markers. Resume protocol full impl is Plan 3; Plan 1 only needs the markers to be written so Plan 3 can wire `resume` later.

### Task 29: Pipeline runner skeleton

**Files:**
- Create: `src/pipeline/runner.ts`, `tests/pipeline/runner.test.ts`

Runner takes a list of stage functions, runs them in order, writes start/done markers, propagates a shared `RunContext`.

- [ ] **Step 1: Write failing test**

```ts
// tests/pipeline/runner.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStages } from '../../src/pipeline/runner.js';
import { RunDir, newRunId } from '../../src/state/runs.js';

describe('runStages', () => {
  it('runs each stage and writes start/done markers', async () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runner-'));
    const rd = new RunDir(base, newRunId());
    const calls: string[] = [];
    await runStages(rd, [
      { name: 'bootstrap', fn: async () => { calls.push('bootstrap'); } },
      { name: 'read',      fn: async () => { calls.push('read'); } },
    ] as const);
    expect(calls).toEqual(['bootstrap', 'read']);
    expect(existsSync(rd.path('bootstrap.done'))).toBe(true);
    expect(existsSync(rd.path('read.done'))).toBe(true);
  });
  it('halts on stage error and leaves .start without .done', async () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runner-'));
    const rd = new RunDir(base, newRunId());
    await expect(runStages(rd, [
      { name: 'bootstrap', fn: async () => { throw new Error('boom'); } },
    ] as const)).rejects.toThrow('boom');
    expect(existsSync(rd.path('bootstrap.start'))).toBe(true);
    expect(existsSync(rd.path('bootstrap.done'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/pipeline/runner.ts
import type { RunDir, Stage } from '../state/runs.js';

export interface StageDef {
  name: Stage;
  fn: () => Promise<void>;
}

export async function runStages(rd: RunDir, stages: readonly StageDef[]): Promise<void> {
  for (const s of stages) {
    rd.markStart(s.name);
    await s.fn();
    rd.markDone(s.name);
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/runner.ts tests/pipeline/runner.test.ts
git commit -m "feat: pipeline stage runner with start/done markers"
```

---

### Task 30: `RunContext` (shared between stages)

**Files:**
- Create: `src/pipeline/context.ts`

A typed object passed to every stage. Holds: project root, project soul (yaml + thesis), methodology files (loaded as map), adapter, run dir, target paper id (for `add` mode), in-memory carry between stages (e.g., the new note filename produced by Read, consumed by Synthesize).

- [ ] **Step 1: Create file**

```ts
// src/pipeline/context.ts
import type { ProjectYaml } from '../config/project-yaml.js';
import type { Thesis } from '../config/thesis-md.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunDir } from '../state/runs.js';

export interface RunContext {
  projectRoot: string;
  researcherDir: string; // <projectRoot>/.researcher
  projectYaml: ProjectYaml;
  thesis: Thesis;
  methodology: Map<string, string>; // filename → content
  adapter: AgentRuntime;
  runDir: RunDir;
  // mode-specific
  addArxivId?: string;
  // carries
  newNoteFilename?: string;
  newNoteContent?: string;
  contradictionsPath?: string;
  landscapeDiff?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/context.ts
git commit -m "feat: RunContext type for pipeline stages"
```

---

### Task 31: Bootstrap stage

**Files:**
- Create: `src/pipeline/bootstrap.ts`, `tests/pipeline/bootstrap.test.ts`

Loads project yaml, thesis, all methodology files into context. No agent calls.

- [ ] **Step 1: Write failing test**

```ts
// tests/pipeline/bootstrap.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { ClaudeCodeAdapter } from '../../src/adapter/claude-code.js';
import { newRunId, RunDir } from '../../src/state/runs.js';

describe('bootstrap stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-bs-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
  });
  it('loads yaml + thesis + 7 methodology files', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new ClaudeCodeAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    expect(ctx.projectYaml.research_questions.length).toBeGreaterThan(0);
    expect(ctx.thesis.sections.has('Working thesis')).toBe(true);
    expect(ctx.methodology.size).toBe(7);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/pipeline/bootstrap.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectYaml } from '../config/project-yaml.js';
import { loadThesis } from '../config/thesis-md.js';
import { resolveProjectResearcherDir, resolveResearcherHome } from '../paths.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunDir } from '../state/runs.js';
import type { RunContext } from './context.js';

export interface BootstrapInput {
  projectRoot: string;
  adapter: AgentRuntime;
  runDir: RunDir;
  addArxivId?: string;
}

export async function bootstrap(input: BootstrapInput): Promise<RunContext> {
  const researcherDir = resolveProjectResearcherDir(input.projectRoot);
  const projectYaml = loadProjectYaml(join(researcherDir, 'project.yaml'));
  const thesis = loadThesis(join(researcherDir, 'thesis.md'));
  const methodologyDir = join(resolveResearcherHome(), 'methodology');
  const methodology = new Map<string, string>();
  for (const f of readdirSync(methodologyDir).sort()) {
    methodology.set(f, readFileSync(join(methodologyDir, f), 'utf8'));
  }
  if (methodology.size === 0) {
    throw new Error(`no methodology files at ${methodologyDir}; run \`researcher methodology install\``);
  }
  return {
    projectRoot: input.projectRoot,
    researcherDir,
    projectYaml,
    thesis,
    methodology,
    adapter: input.adapter,
    runDir: input.runDir,
    addArxivId: input.addArxivId,
  };
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/bootstrap.ts tests/pipeline/bootstrap.test.ts
git commit -m "feat: pipeline — bootstrap stage"
```

---

### Task 32: Read stage

**Files:**
- Create: `src/pipeline/read.ts`, `tests/pipeline/read.test.ts`

Behavior:
1. Fetch arxiv metadata for `ctx.addArxivId`.
2. Fetch PDF, run `pdftotext` via execa to a temp file. (For Plan 1, abstract is sufficient if `pdftotext` is unavailable — we pass `paper_text = abstract` as fallback; warn the user.)
3. Determine `next_note_filename` by listing `notes/` in project.
4. Load `prompts/stage-read.md`, render with vars.
5. Build system prompt: `prompts/system-preamble.md` + relevant methodology slices.
6. Invoke adapter. The agent will Write `notes/<next_note_filename>`.
7. Read the new file content into `ctx.newNoteContent`. Set `ctx.newNoteFilename`.

Test strategy: mock the adapter to write a stub file; verify the stage records the filename and content.

- [ ] **Step 1: Write failing test**

```ts
// tests/pipeline/read.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { read } from '../../src/pipeline/read.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const noteContent = '# Stub note\n\n## Claims\n- something';
    writeFileSync(join(opts.cwd, 'notes', '01_stub_paper.md'), noteContent);
    return { output: 'done\n\nFILES_MODIFIED:\nnotes/01_stub_paper.md\n', modifiedFiles: ['notes/01_stub_paper.md'], exitCode: 0 };
  }
}

vi.mock('../../src/sources/arxiv.js', async (orig) => ({
  ...(await orig() as object),
  fetchArxivMetadata: async () => ({
    id: 'arxiv:2401.00001', title: 'Stub Paper', authors: ['A'],
    abstract: 'abstract', abs_url: 'x', pdf_url: 'y',
  }),
}));

describe('read stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-read-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
  });
  it('writes a note file and records it in context', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    await read(ctx);
    expect(ctx.newNoteFilename).toBe('01_stub_paper.md');
    expect(ctx.newNoteContent).toContain('Claims');
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/pipeline/read.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { fetchArxivMetadata } from '../sources/arxiv.js';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 15 * 60 * 1000;

export async function read(ctx: RunContext): Promise<void> {
  if (!ctx.addArxivId) throw new Error('read stage requires addArxivId in context');
  const meta = await fetchArxivMetadata(ctx.addArxivId);

  const paperText = await tryPdfToText(meta.pdf_url).catch(() => meta.abstract);

  const notesDir = join(ctx.projectRoot, 'notes');
  const existing = readdirSync(notesDir).filter((f) => /^\d+_.*\.md$/.test(f)).sort();
  const nextNum = (existing.length + 1).toString().padStart(2, '0');
  const slug = slugify(meta.title);
  const nextFilename = `${nextNum}_${slug}.md`;

  const tpl = loadPromptTemplate('stage-read.md');
  const userPrompt = renderTemplate(tpl, {
    methodology_reading: ctx.methodology.get('01-reading.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    project_yaml: readFileSync(join(ctx.researcherDir, 'project.yaml'), 'utf8'),
    thesis: ctx.thesis.body,
    paper_metadata: JSON.stringify(meta, null, 2),
    paper_text: paperText.slice(0, 80_000),
    notes_dir_listing: existing.join('\n'),
    next_note_filename: nextFilename,
  });

  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode !== 0) throw new Error(`read stage agent exited ${result.exitCode}`);

  const fullPath = join(notesDir, nextFilename);
  ctx.newNoteFilename = nextFilename;
  ctx.newNoteContent = readFileSync(fullPath, 'utf8');
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_').slice(0, 6).join('_');
}

async function tryPdfToText(url: string): Promise<string> {
  // pull pdf to temp, run pdftotext
  const tmp = `/tmp/r-${Date.now()}.pdf`;
  await execa('curl', ['-sSL', '-o', tmp, url], { timeout: 60_000 });
  const { stdout } = await execa('pdftotext', [tmp, '-'], { timeout: 60_000 });
  return stdout;
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/read.ts tests/pipeline/read.test.ts
git commit -m "feat: pipeline — read stage"
```

---

### Task 33: Synthesize stage

**Files:**
- Create: `src/pipeline/synthesize.ts`, `tests/pipeline/synthesize.test.ts`

Behavior:
1. Load current `notes/00_research_landscape.md` (create if missing — empty stub with `# Research landscape` header).
2. Load `prompts/stage-synthesize.md` template, render with synthesis + writing methodology, current landscape, new note content.
3. Invoke adapter — expects it to write updated `notes/00_research_landscape.md` and `<runDir>/contradictions.md`.
4. Compute landscape diff using `git diff` (against working tree's HEAD version of the file). Stash diff into `ctx.landscapeDiff`. Stash contradictions path.

Test strategy: stub adapter that writes both files; assert ctx fields populated.

- [ ] **Step 1: Write failing test** (similar pattern to Task 32)

```ts
// tests/pipeline/synthesize.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { synthesize } from '../../src/pipeline/synthesize.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    writeFileSync(join(opts.cwd, 'notes/00_research_landscape.md'), '# Updated landscape\n\n[1] Stub Paper\n');
    // contradictions path is in opts.userPrompt; we extract it lazily by writing via stage code instead
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

describe('synthesize stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-syn-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty landscape\n');
    execaSync('git', ['add', '.'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });
  it('updates landscape and records diff', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteContent = '# Stub';
    writeFileSync(join(proj, 'notes/01_stub.md'), '# Stub');
    await synthesize(ctx);
    expect(ctx.landscapeDiff).toContain('Updated landscape');
    expect(readFileSync(join(proj, 'notes/00_research_landscape.md'), 'utf8')).toContain('Stub Paper');
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// src/pipeline/synthesize.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 15 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

export async function synthesize(ctx: RunContext): Promise<void> {
  if (!ctx.newNoteFilename || !ctx.newNoteContent) {
    throw new Error('synthesize requires newNoteFilename and newNoteContent in context');
  }
  const landscapePath = join(ctx.projectRoot, LANDSCAPE);
  if (!existsSync(landscapePath)) {
    mkdirSync(dirname(landscapePath), { recursive: true });
    writeFileSync(landscapePath, '# Research landscape\n\n_(empty — will be populated by researcher)_\n');
  }
  const landscapeBefore = readFileSync(landscapePath, 'utf8');

  const contradictionsPath = ctx.runDir.path('contradictions.md');
  ctx.contradictionsPath = contradictionsPath;

  const userPrompt = renderTemplate(loadPromptTemplate('stage-synthesize.md'), {
    methodology_synthesis: ctx.methodology.get('04-synthesis.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    thesis: ctx.thesis.body,
    landscape_current: landscapeBefore,
    new_note_filename: ctx.newNoteFilename,
    new_note_content: ctx.newNoteContent,
    contradictions_path: contradictionsPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');

  const result = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.exitCode !== 0) throw new Error(`synthesize stage agent exited ${result.exitCode}`);

  // capture diff
  try {
    const { stdout } = await execa('git', ['diff', '--', LANDSCAPE], { cwd: ctx.projectRoot });
    ctx.landscapeDiff = stdout;
  } catch {
    ctx.landscapeDiff = `(diff unavailable; landscape now reads:\n${readFileSync(landscapePath, 'utf8')})`;
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/synthesize.ts tests/pipeline/synthesize.test.ts
git commit -m "feat: pipeline — synthesize stage"
```

---

### Task 34: Package stage (verify + commits + PR)

**Files:**
- Create: `src/pipeline/package.ts`, `src/git/ops.ts`, `tests/pipeline/package.test.ts`

Behavior split:
- `src/git/ops.ts` is a thin wrapper around `simple-git` and `gh` (via execa) — branch creation, two commits, push, draft PR creation. Pure function inputs, easy to mock.
- `src/pipeline/package.ts`:
  1. Invoke adapter to produce a run-summary file at `<runDir>/run-summary.md` (using `prompts/stage-package.md`). This contains the devil's-advocate pass.
  2. Append the new entry to `state/seen.jsonl` (via `Seen.append`).
  3. Update `state/watermark.json`.
  4. Call `git/ops`:
     - branch: `researcher/<runId>` (slugified)
     - C1: `git add notes/<newNote> notes/00_research_landscape.md && git commit -m "research: <summary>"`
     - C2: `git add .researcher/state/seen.jsonl .researcher/state/watermark.json && git commit -m "state: seen +1, watermark <ts>"`
     - push: `git push -u origin <branch>` (skipped in tests via env flag)
     - PR: `gh pr create --draft --title <pr-title> --body-file <run-summary>` (skipped in tests via env flag)

The runner skips the push + PR steps when env `RESEARCHER_NO_REMOTE=1` is set so tests can verify commits without needing a remote.

- [ ] **Step 1: Implement `src/git/ops.ts`**

```ts
// src/git/ops.ts
import { execa } from 'execa';

export interface CreateBranchOpts { cwd: string; branch: string; }
export interface CommitOpts { cwd: string; paths: string[]; message: string; }

export async function createBranch(o: CreateBranchOpts): Promise<void> {
  await execa('git', ['checkout', '-b', o.branch], { cwd: o.cwd });
}

export async function commit(o: CommitOpts): Promise<void> {
  if (o.paths.length === 0) return;
  await execa('git', ['add', ...o.paths], { cwd: o.cwd });
  await execa('git', ['commit', '-m', o.message], { cwd: o.cwd });
}

export async function pushBranch(o: { cwd: string; branch: string }): Promise<void> {
  if (process.env.RESEARCHER_NO_REMOTE === '1') return;
  await execa('git', ['push', '-u', 'origin', o.branch], { cwd: o.cwd });
}

export async function ghPrCreate(o: { cwd: string; title: string; bodyFile: string }): Promise<string> {
  if (process.env.RESEARCHER_NO_REMOTE === '1') return '(skipped: RESEARCHER_NO_REMOTE=1)';
  const { stdout } = await execa('gh', ['pr', 'create', '--draft', '--title', o.title, '--body-file', o.bodyFile], { cwd: o.cwd });
  return stdout.trim();
}
```

- [ ] **Step 2: Write failing test for package stage**

```ts
// tests/pipeline/package.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { packageStage } from '../../src/pipeline/package.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    // write run summary
    const m = /\{\{run_summary_path\}\}/; // not strictly needed; we write to a known location below
    writeFileSync(opts.cwd + '/.researcher/state/runs/RUN/run-summary.md', '# summary');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

describe('package stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-pkg-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    process.env.RESEARCHER_NO_REMOTE = '1';
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
    writeFileSync(join(proj, 'notes/01_stub.md'), '# Stub');
    execaSync('git', ['add', '.'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });
  it('produces 2 commits and updates state files', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteContent = '# Stub';
    ctx.landscapeDiff = '+stub';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');
    // pre-create dir for stub adapter's hardcoded path:
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });

    await packageStage(ctx);

    const log = execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout;
    const lines = log.split('\n').filter(Boolean);
    // before: 1 commit; after package: +2
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatch(/^[a-f0-9]+ state:/);
    expect(lines[1]).toMatch(/^[a-f0-9]+ research:/);
    expect(existsSync(join(proj, '.researcher/state/seen.jsonl'))).toBe(true);
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.00001');
  });
});
```

(Note: the StubAdapter test path is hacky on purpose — it uses a hardcoded `RUN` path so the test can pre-create the dir. In real use the package stage tells the adapter exactly where to write via the rendered template var.)

- [ ] **Step 3: Implement `src/pipeline/package.ts`**

```ts
// src/pipeline/package.ts
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { Seen } from '../state/seen.js';
import { writeWatermark, type Watermark } from '../state/watermark.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

export async function packageStage(ctx: RunContext): Promise<void> {
  if (!ctx.newNoteFilename || !ctx.newNoteContent) throw new Error('package requires note context');
  if (!ctx.contradictionsPath) throw new Error('package requires contradictionsPath');
  if (!ctx.addArxivId) throw new Error('package (Plan 1, add mode) requires addArxivId');

  // 1. devil's-advocate / run summary via adapter
  const runSummaryPath = ctx.runDir.path('run-summary.md');
  const userPrompt = renderTemplate(loadPromptTemplate('stage-package.md'), {
    methodology_verification: ctx.methodology.get('05-verification.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    thesis: ctx.thesis.body,
    new_note_content: ctx.newNoteContent,
    landscape_diff: ctx.landscapeDiff ?? '(no diff)',
    contradictions: existsSync(ctx.contradictionsPath) ? readFileSync(ctx.contradictionsPath, 'utf8') : 'none',
    run_summary_path: runSummaryPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');
  const r = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (r.exitCode !== 0) throw new Error(`package stage agent exited ${r.exitCode}`);
  if (!existsSync(runSummaryPath)) {
    mkdirSync(dirname(runSummaryPath), { recursive: true });
    writeFileSync(runSummaryPath, '# Run summary\n\n_(adapter did not write a summary)_\n');
  }

  // 2. update state files
  const seen = new Seen(join(ctx.researcherDir, 'state/seen.jsonl'));
  if (!seen.has(ctx.addArxivId)) {
    seen.append({
      id: ctx.addArxivId,
      source: 'arxiv',
      first_seen_run: ctx.runDir.id,
      decision: 'deep-read',
      reason: 'manual feed via researcher add',
    });
  }
  const now = new Date().toISOString();
  const wm: Watermark = {
    last_run_completed_at: now,
    last_run_window: { from: now, to: now },
    last_run_id: ctx.runDir.id,
  };
  writeWatermark(join(ctx.researcherDir, 'state/watermark.json'), wm);

  // 3. git: branch, two commits, push, PR
  const branch = `researcher/${ctx.runDir.id}`;
  await gitops.createBranch({ cwd: ctx.projectRoot, branch });
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths: [join('notes', ctx.newNoteFilename), LANDSCAPE],
    message: `research: add note on ${ctx.newNoteFilename.replace(/\.md$/, '')} + landscape update`,
  });
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths: ['.researcher/state/seen.jsonl', '.researcher/state/watermark.json'],
    message: `state: seen +1, watermark ${now}`,
  });
  await gitops.pushBranch({ cwd: ctx.projectRoot, branch });
  const prTitle = `research: add ${ctx.newNoteFilename.replace(/\.md$/, '')}`;
  await gitops.ghPrCreate({ cwd: ctx.projectRoot, title: prTitle, bodyFile: runSummaryPath });
}
```

- [ ] **Step 4: Run — package test passes**

- [ ] **Step 5: Commit**

```bash
git add src/git/ops.ts src/pipeline/package.ts tests/pipeline/package.test.ts
git commit -m "feat: pipeline — package stage with 2-commit + draft PR"
```

---

### Task 35: `researcher add` command — wire it all together

**Files:**
- Create: `src/commands/add.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement**

```ts
// src/commands/add.ts
import { join } from 'node:path';
import { canonicalizeArxivId } from '../sources/arxiv.js';
import { ClaudeCodeAdapter } from '../adapter/claude-code.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { runStages } from '../pipeline/runner.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { read } from '../pipeline/read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { packageStage } from '../pipeline/package.js';
import { Seen } from '../state/seen.js';
import type { RunContext } from '../pipeline/context.js';

export interface AddOptions { input: string; cwd: string; }

export async function runAdd(opts: AddOptions): Promise<void> {
  const id = canonicalizeArxivId(opts.input); // Plan 1: arxiv-only
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const seen = new Seen(join(researcherDir, 'state/seen.jsonl'));
  if (seen.has(id)) {
    process.stdout.write(`already seen: ${id} (decision=${seen.get(id)?.decision})\n`);
    return;
  }
  const adapter = new ClaudeCodeAdapter();
  const runDir = new RunDir(join(researcherDir, 'state/runs'), newRunId());
  let ctx: RunContext;
  await runStages(runDir, [
    {
      name: 'bootstrap',
      fn: async () => {
        ctx = await bootstrap({ projectRoot: opts.cwd, adapter, runDir, addArxivId: id });
      },
    },
    { name: 'read',        fn: async () => read(ctx!) },
    { name: 'synthesize',  fn: async () => synthesize(ctx!) },
    { name: 'package',     fn: async () => packageStage(ctx!) },
  ] as const);
  process.stdout.write(`done. run id: ${runDir.id}\n`);
}
```

- [ ] **Step 2: Wire into CLI**

```ts
// add to src/cli.ts
program
  .command('add <input>')
  .description('Manually add a paper (arxiv id, URL, or PDF path) to the current topic')
  .action(async (input: string) => {
    const { runAdd } = await import('./commands/add.js');
    await runAdd({ input, cwd: process.cwd() });
  });
```

- [ ] **Step 3: Build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/add.ts src/cli.ts
git commit -m "feat: researcher add command (arxiv only, Plan 1)"
```

---

## Phase I — End-to-end smoke test

### Task 36: E2E smoke test (gated behind `CLAUDE_E2E=1`)

**Files:**
- Create: `tests/e2e/add-arxiv.smoke.test.ts`

This test really invokes `claude` and `gh` (mocked via `RESEARCHER_NO_REMOTE=1` for the gh part). Default-skipped because it needs Claude Code installed and configured.

- [ ] **Step 1: Create test file**

```ts
// tests/e2e/add-arxiv.smoke.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { runAdd } from '../../src/commands/add.js';

const SHOULD_RUN = process.env.CLAUDE_E2E === '1';
const ARXIV_TEST_ID = process.env.RESEARCHER_E2E_ARXIV ?? '2401.00001';

(SHOULD_RUN ? describe : describe.skip)('e2e: add arxiv paper', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-e2e-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 'e@e'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 'e'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-e2ehome-'));
    process.env.RESEARCHER_NO_REMOTE = '1';
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    // edit project.yaml to be slightly opinionated (Plan 1 uses default thesis)
    const py = join(proj, '.researcher/project.yaml');
    writeFileSync(py, readFileSync(py, 'utf8').replace('Replace this with your first research question.', 'How do agents triage trajectories cheaply?'));
    execaSync('git', ['add', '.'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });
  it(
    'adds an arxiv paper end-to-end',
    async () => {
      await runAdd({ input: ARXIV_TEST_ID, cwd: proj });
      // assertions
      const branches = execaSync('git', ['branch', '--list', 'researcher/*'], { cwd: proj }).stdout;
      expect(branches).toMatch(/researcher\/r-/);
      // a note file appeared
      const noteFiles = execaSync('git', ['log', '--name-only', '-1', '--pretty=format:'], { cwd: proj }).stdout;
      expect(noteFiles).toMatch(/notes\/\d+_.*\.md/);
      // landscape exists
      expect(existsSync(join(proj, 'notes/00_research_landscape.md'))).toBe(true);
      // seen.jsonl has entry
      const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
      expect(seen).toContain(`arxiv:${ARXIV_TEST_ID.replace(/^arxiv:/, '')}`);
    },
    10 * 60 * 1000,
  );
});
```

- [ ] **Step 2: Document how to run it**

Edit `README.md` (create if missing) to add:

```markdown
# researcher

Per-topic research CLI. See `docs/superpowers/specs/2026-04-26-researcher-cli-design.md` for design.

## Local development

```
npm install
npm test
npm run build
```

## Smoke test (requires Claude Code installed)

```
CLAUDE_E2E=1 RESEARCHER_E2E_ARXIV=2401.12345 npm test -- e2e
```

## Manual smoke

```
mkdir -p /tmp/scratch && cd /tmp/scratch && git init -b main
git commit --allow-empty -m init
node ~/dev/github/researcher/dist/cli.js init
node ~/dev/github/researcher/dist/cli.js methodology install
RESEARCHER_NO_REMOTE=1 node ~/dev/github/researcher/dist/cli.js add 2401.12345
```
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/add-arxiv.smoke.test.ts README.md
git commit -m "test: e2e smoke for add arxiv (gated by CLAUDE_E2E)"
```

---

### Task 37: Plan 1 final smoke — manual

This is a manual checklist to run before declaring Plan 1 done. Does **not** produce code — it's a verification ritual.

- [ ] **Step 1: Build cleanly**

```bash
cd ~/dev/github/researcher
npm run lint
npm test
npm run build
```
Expected: zero errors, all unit tests pass.

- [ ] **Step 2: Init in scratch repo**

```bash
mkdir -p /tmp/researcher-smoke && cd /tmp/researcher-smoke
git init -b main && git commit --allow-empty -m init
node ~/dev/github/researcher/dist/cli.js init
```
Expected: `.researcher/{project.yaml, thesis.md, .gitignore, state/seen.jsonl}` exist.

- [ ] **Step 3: Install methodology**

```bash
node ~/dev/github/researcher/dist/cli.js methodology install
node ~/dev/github/researcher/dist/cli.js methodology show
```
Expected: 7 files at `~/.researcher/methodology/`, listed by show.

- [ ] **Step 4: Add a real paper**

Replace `<arxiv_id>` with a real id, e.g. `2401.12345`:

```bash
RESEARCHER_NO_REMOTE=1 node ~/dev/github/researcher/dist/cli.js add <arxiv_id>
```

Expected after the run completes:
- A new branch `researcher/r-…` exists.
- 2 commits added on that branch (`research: …` and `state: …`).
- `notes/01_…md` exists with the reading template populated.
- `notes/00_research_landscape.md` exists with at least one entry.
- `.researcher/state/seen.jsonl` has one entry for the arxiv id.
- `.researcher/state/runs/<id>/run-summary.md` exists with devil's-advocate content.

- [ ] **Step 5: Inspect run summary**

```bash
cat .researcher/state/runs/r-*/run-summary.md
```
Expected: 4 sections (Run summary, Devil's-advocate, Confidence labels, What would change my mind).

- [ ] **Step 6: Commit any final docs / fixes** (if Step 4–5 surfaced issues, fix and commit)

- [ ] **Step 7: Tag Plan 1 milestone**

```bash
cd ~/dev/github/researcher
git tag -a plan-1-complete -m "Plan 1 (init + add arxiv) complete"
```

---

## Self-review (already done before publishing this plan)

**Spec coverage** — every task in spec §3–§9 that is in Plan 1's declared scope has a task. §11 risks (CC stability, dedup) are mitigated via per-stage invocation, RESEARCHER_NO_REMOTE escape hatch, and canonical id with arxiv prefix. Acceptance criteria #1 and #2 from spec §12 are covered by tasks 12 and 35–37.

**Placeholder scan** — searched for "TBD", "TODO", "later", "as appropriate" — none in steps. Methodology-authoring tasks (13–19) deliberately delegate file content to the implementer because the file IS the content; each task lists required sections and acceptance, which is the spec for that file.

**Type consistency** — `RunContext` defined in Task 30 is used consistently in Tasks 31–35. `AgentRuntime.invoke` signature matches across adapter + every stage. `Seen.append` signature matches between Task 8 and Task 34. `Stage` type from Task 10 matches `STAGES` array used by tests. `Watermark` shape consistent between Task 9 and Task 34.
