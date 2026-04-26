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
