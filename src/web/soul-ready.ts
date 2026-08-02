import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectYaml, type ProjectYaml } from '../config/project-yaml.js';
import { isThesisTemplate } from '../onboard/all-templates-check.js';
import { isThesisBodyHollow } from '../onboard/thesis-hollow.js';
import { loadThesis } from '../config/thesis-md.js';
import { resolveProjectResearcherDir } from '../paths.js';

export interface SoulReadyAssessment {
  ready: boolean;
  /** Machine-readable reasons when not ready. */
  reasons: string[];
  hasOpenQuestions: boolean;
}

/** Placeholder / scaffold arxiv query that means "not configured". */
const PLACEHOLDER_QUERIES = new Set([
  'your topic keyword',
  'your topic keywords',
]);
export { isThesisBodyHollow } from '../onboard/thesis-hollow.js';

/**
 * Assess whether a topic has enough soul for autonomous `run`.
 * Shared by Web UI (needsSetup / Run disabled) and POST /run gate.
 */
export function assessSoulReady(topicDir: string): SoulReadyAssessment {
  const reasons: string[] = [];
  const researcherDir = resolveProjectResearcherDir(topicDir);
  if (!existsSync(researcherDir)) {
    return {
      ready: false,
      reasons: ['missing .researcher/'],
      hasOpenQuestions: false,
    };
  }

  const hasOpenQuestions = existsSync(join(researcherDir, 'open_questions.md'));
  if (hasOpenQuestions) {
    reasons.push('open_questions.md present — answer or remove before running');
  }

  if (isThesisTemplate(topicDir) || isThesisHollow(topicDir)) {
    reasons.push('thesis is still template/hollow — complete setup first');
  } else {
    try {
      loadThesis(join(researcherDir, 'thesis.md'));
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : 'thesis.md invalid');
    }
  }

  let yaml: ProjectYaml | null = null;
  try {
    yaml = loadProjectYaml(join(researcherDir, 'project.yaml'));
  } catch {
    reasons.push('project.yaml missing or invalid');
  }

  if (yaml && !hasUsableSource(yaml)) {
    reasons.push('no usable source queries or feed inbox configured');
  }

  return {
    ready: reasons.length === 0,
    reasons,
    hasOpenQuestions,
  };
}

export function isSoulReady(topicDir: string): boolean {
  return assessSoulReady(topicDir).ready;
}

function isThesisHollow(topicDir: string): boolean {
  const path = join(resolveProjectResearcherDir(topicDir), 'thesis.md');
  if (!existsSync(path)) return true;
  let body = '';
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    return true;
  }
  return isThesisBodyHollow(body);
}

function hasUsableSource(yaml: ProjectYaml): boolean {
  for (const s of yaml.sources) {
    if (s.kind === 'x-inbox') {
      if (s.inbox_dir && s.inbox_dir.trim() !== '') return true;
      continue;
    }
    const queries = (s.queries ?? [])
      .map((q) => q.trim())
      .filter((q) => q !== '' && !PLACEHOLDER_QUERIES.has(q.toLowerCase()));
    if (queries.length > 0) return true;
  }
  return false;
}
