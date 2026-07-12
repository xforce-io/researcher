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

/**
 * Map the Web setup form onto onboard question ids.
 * Q1 = oneline (required). Q8 = stake/design anchor. Q6 = seed keywords.
 * Everything else is skipped so rewrite preserves template defaults + TODO.
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
      answers.push(answerOrSkip(q.id, q.fieldId, form.seeds));
      continue;
    }
    // Optional language nudge: fold into topic_oneline context only if Q missing.
    answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'skipped' });
  }

  // If language was provided, append a short note onto oneline answer for rewrite context
  // without inventing a new question id — agent sees it in Q1 text.
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
    writeRunLog({
      repoRoot: input.topicDir,
      answers,
      prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
      response: err instanceof Error ? err.message : String(err),
      result: { status: 'rewrite_failed', error: err instanceof Error ? err.message : String(err) },
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
