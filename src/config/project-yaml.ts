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
  kind: z.enum(['arxiv', 'semantic_scholar', 'openreview', 'github', 'rss', 'x-inbox']),
  queries: z.array(z.string()).optional(),
  seed_papers: z.array(z.string()).optional(),
  follow: z.array(z.enum(['citations', 'references'])).optional(),
  /** For kind: x-inbox — repo-external directory of digest files produced by the
   * preprocessing layer (researcher-invest-feeds). Supports a leading ~. */
  inbox_dir: z.string().optional(),
  /** For kind: x-inbox — opt into the researcher-side enrich/verify stage (#27).
   * When true, after feed-synthesize an extra stage looks up primary fundamental
   * data for the window's targets and folds verified evidence back into the note/report.
   * Default off = the feed path's current synthesize-only behavior. */
  enrich: z.boolean().optional(),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
});
const Axis = z.object({ name: z.string(), values: z.array(z.string()).min(1) });
const Cadence = z.object({
  default_interval_days: z.number().int().positive(),
  backoff_after_empty_runs: z.number().int().nonnegative(),
});

const Meta = z
  .object({
    topic_oneline: z.string().optional(),
    // Output language for all prose the agent writes (notes/report/landscape/
    // summaries/triage reasons). BCP-47 short code; free string for extensibility.
    language: z.string().default('zh'),
  })
  .default({ language: 'zh' });

// How a run's output is delivered. Per-topic, single source of truth (there is no
// global env override). `local` = commit only (paper path still branches + commits,
// but no push / no PR); `remote` = commit + push + `gh pr create`. Default local so a
// fresh topic with no git remote works out of the box and never fails hard on push.
const Delivery = z
  .object({ mode: z.enum(['local', 'remote']).default('local') })
  .default({ mode: 'local' });

export const ProjectYamlSchema = z.object({
  meta: Meta,
  delivery: Delivery,
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
