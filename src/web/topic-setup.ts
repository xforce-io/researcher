import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { MilkieAdapter } from '../adapter/milkie.js';
import type { AgentRuntime } from '../adapter/interface.js';
import {
  composeSystemPrompt,
  composeUserPrompt,
  rewriteAnswers,
} from '../onboard/rewrite.js';
import { parseOnboardingMd } from '../onboard/schema.js';
import { isOnboardable } from '../onboard/all-templates-check.js';
import {
  makeSlug,
  writeOnboardArtifacts,
  writeRunLog,
} from '../onboard/persist.js';
import type { SerializedAnswer } from '../onboard/state.js';
import {
  resolvePackageRoot,
  resolveProjectResearcherDir,
  resolveResearcherHome,
} from '../paths.js';
import { loadProjectYaml } from '../config/project-yaml.js';

export interface TopicSetupForm {
  oneline: string;
  stake?: string;
  seeds?: string;
  language?: string;
}

export interface GenerateTopicSetupInput {
  topicDir: string;
  form: TopicSetupForm;
  runtime?: AgentRuntime;
  timeoutMs?: number;
}

export interface GenerateTopicSetupResult {
  projectYaml: string;
  thesisMd: string;
  answers: SerializedAnswer[];
}

export interface ApplyTopicSetupInput {
  topicDir: string;
  projectYaml: string;
  thesisMd: string;
  oneline: string;
}

function loadOnboardingMethodology(): { body: string; onboarding: ReturnType<typeof parseOnboardingMd> } {
  const path = join(resolveResearcherHome(), 'methodology', 'onboarding.md');
  if (!existsSync(path)) {
    throw new Error('onboarding methodology missing; run `researcher methodology install`');
  }
  const body = readFileSync(path, 'utf8');
  return { body, onboarding: parseOnboardingMd(body) };
}

function answerOrSkip(questionId: string, fieldId: string, text: string | undefined): SerializedAnswer {
  const t = text?.trim() ?? '';
  if (!t) return { questionId, fieldId, kind: 'skipped' };
  return { questionId, fieldId, kind: 'text', text: t };
}

/** Derive a couple of starter RQs so the agent is not left with only skipped fields. */
export function defaultResearchQuestionsFromOneline(oneline: string): string {
  const t = oneline.trim();
  return [
    `How is the state of the art currently defined for: ${t}?`,
    `What mechanisms or evaluation criteria most constrain progress on: ${t}?`,
  ].join('\n');
}

/** Pull ASCII-ish keyword phrases from free text for seed queries. */
export function defaultSeedsFromOneline(oneline: string): string {
  const words = oneline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const uniq = [...new Set(words)].slice(0, 6);
  if (uniq.length >= 2) return uniq.join(' ');
  // Fall back to the raw oneline so the agent still has a seed signal.
  return oneline.trim();
}

/**
 * Map the Web setup form onto onboard question ids.
 * Q1 = oneline (required). Q8 = stake/design anchor. Q6 = seed keywords.
 * When seeds/RQs are empty we auto-seed from oneline so the rewrite agent is not
 * stuck with only SKIPPED fields (which previously caused endless deliberation
 * and empty marker blocks).
 */
export function buildSetupAnswers(
  form: TopicSetupForm,
  questions: { id: string; fieldId: string }[],
): SerializedAnswer[] {
  const oneline = form.oneline.trim();
  if (!oneline) throw new Error('missing one-line');

  const byField = new Map(questions.map((q) => [q.fieldId, q]));
  const byId = new Map(questions.map((q) => [q.id, q]));

  const q1 = byField.get('topic_oneline') ?? byId.get('Q1');
  if (!q1) throw new Error('onboarding.md missing topic_oneline / Q1');

  const seeds = form.seeds?.trim() || defaultSeedsFromOneline(oneline);
  const rqs = defaultResearchQuestionsFromOneline(oneline);

  const answers: SerializedAnswer[] = [];
  for (const q of questions) {
    if (q.id === q1.id || q.fieldId === 'topic_oneline') {
      answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'text', text: oneline });
      continue;
    }
    if (q.fieldId === 'design_anchor' || q.id === 'Q8') {
      answers.push(answerOrSkip(q.id, q.fieldId, form.stake));
      continue;
    }
    if (q.fieldId === 'seed_keywords' || q.id === 'Q6') {
      answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'text', text: seeds });
      continue;
    }
    if (q.fieldId === 'research_questions' || q.id === 'Q2') {
      answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'text', text: rqs });
      continue;
    }
    answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'skipped' });
  }

  // Language preference rides on Q1 so rewrite sees it without a new field id.
  if (form.language?.trim()) {
    const lang = form.language.trim();
    const idx = answers.findIndex((a) => a.questionId === q1.id);
    if (idx >= 0 && answers[idx].kind === 'text') {
      answers[idx] = {
        ...answers[idx],
        text: `${oneline}\n\n[Output language preference: ${lang}]`,
      };
    }
  }

  return answers;
}

export function assertSetupAllowed(topicDir: string): void {
  if (!existsSync(resolveProjectResearcherDir(topicDir))) {
    throw new Error('topic has no .researcher/');
  }
  if (!isOnboardable(topicDir)) {
    throw new Error('topic is already set up (or has non-template content); edit files manually');
  }
}

export async function generateTopicSetup(
  input: GenerateTopicSetupInput,
): Promise<GenerateTopicSetupResult> {
  assertSetupAllowed(input.topicDir);
  const { body: methodologyBody, onboarding } = loadOnboardingMethodology();
  const answers = buildSetupAnswers(input.form, onboarding.questions);

  const pkg = resolvePackageRoot();
  // Prefer live files under the topic (may already have oneline from Web create).
  const dotR = resolveProjectResearcherDir(input.topicDir);
  const templateProjectYaml = existsSync(join(dotR, 'project.yaml'))
    ? readFileSync(join(dotR, 'project.yaml'), 'utf8')
    : readFileSync(join(pkg, 'templates/project.yaml'), 'utf8');
  const templateThesisMd = existsSync(join(dotR, 'thesis.md'))
    ? readFileSync(join(dotR, 'thesis.md'), 'utf8')
    : readFileSync(join(pkg, 'templates/thesis.md'), 'utf8');

  const runtime = input.runtime ?? new MilkieAdapter();
  const systemPrompt = composeSystemPrompt(methodologyBody);
  const userPrompt = composeUserPrompt({
    runtime,
    cwd: input.topicDir,
    methodologyBody,
    onboarding,
    answers,
    templateProjectYaml,
    templateThesisMd,
  });

  try {
    const result = await rewriteAnswers({
      runtime,
      cwd: input.topicDir,
      methodologyBody,
      onboarding,
      answers,
      templateProjectYaml,
      templateThesisMd,
      timeoutMs: input.timeoutMs,
    });
    writeRunLog({
      repoRoot: input.topicDir,
      answers,
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      response: result.rawOutput,
      result: { status: 'ok' },
    });
    return {
      projectYaml: result.projectYaml,
      thesisMd: result.thesisMd,
      answers,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRunLog({
      repoRoot: input.topicDir,
      answers,
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      // Keep the error message; raw model text (if any) is embedded by rewriteAnswers.
      response: message,
      result: { status: 'rewrite_failed', error: message },
    });
    throw err;
  }
}

export async function applyTopicSetup(input: ApplyTopicSetupInput): Promise<void> {
  assertSetupAllowed(input.topicDir);
  const oneline = input.oneline.trim();
  if (!oneline) throw new Error('missing one-line');
  if (!input.projectYaml.trim()) throw new Error('missing project.yaml');
  if (!input.thesisMd.trim()) throw new Error('missing thesis.md');

  // Soft validate YAML shape (full ProjectYamlSchema may fail on partial agent output).
  try {
    const parsed = parseYaml(input.projectYaml);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
  } catch (err) {
    throw new Error(`invalid project.yaml: ${err instanceof Error ? err.message : String(err)}`);
  }

  await writeOnboardArtifacts({
    repoRoot: input.topicDir,
    projectYaml: input.projectYaml,
    thesisMd: input.thesisMd,
    slug: makeSlug(oneline),
  });
}

/** Prefill helpers for the setup form from an existing topic dir. */
export function readSetupPrefill(topicDir: string): { oneline: string; language: string } {
  try {
    const py = loadProjectYaml(join(resolveProjectResearcherDir(topicDir), 'project.yaml'));
    return {
      oneline: py.meta.topic_oneline ?? '',
      language: py.meta.language ?? 'zh',
    };
  } catch {
    return { oneline: '', language: 'zh' };
  }
}
