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
    // Onboarding drafts are long; low caps often truncate before marker blocks.
    maxTokens: 8192,
  });
  if (result.exitCode !== 0) {
    const detail = (result.output || result.stderr || '').trim();
    const short = detail
      ? (detail.length > 600 ? `${detail.slice(0, 600)}…` : detail)
      : `agent runtime exit code ${result.exitCode}`;
    throw new Error(
      detail
        ? `${short} (exit ${result.exitCode})`
        : `agent runtime exit code ${result.exitCode}`,
    );
  }
  try {
    const parsed = parseResponse(result.output);
    return { ...parsed, rawOutput: result.output };
  } catch (err) {
    const raw = (result.output || '').trim();
    const finish = result.finishReason ? ` finishReason=${result.finishReason}` : '';
    if (!raw) {
      throw new Error(
        `rewrite response empty${finish} — model likely hit the output limit while reasoning. ` +
          'Try Generate again, or add Stake / Seed keywords so the draft has more to work with.',
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    const snippet = raw.length > 280 ? `${raw.slice(0, 140)}…${raw.slice(-140)}` : raw;
    throw new Error(`${msg}${finish}. Model output snippet: ${snippet}`);
  }
}

export function composeSystemPrompt(methodologyBody: string): string {
  return [
    'You are the researcher onboarding assistant.',
    "Rewrite the user's rough answers into the topic's project.yaml and thesis.md.",
    'Follow the style guide below verbatim. Preserve user intent. Do not invent facts.',
    '',
    'OUTPUT CONTRACT (non-negotiable):',
    '- Your final message MUST contain exactly two blocks with these literal markers:',
    '  <<<PROJECT_YAML>>> … <<<END_PROJECT_YAML>>> then <<<THESIS_MD>>> … <<<END_THESIS_MD>>>',
    '- Put the markers in the final assistant text (not only in hidden reasoning).',
    '- Inside each block: raw file body only. Do NOT wrap in markdown code fences',
    '  (no ```yaml / ```markdown / ```). The first line after <<<PROJECT_YAML>>> must be',
    '  valid YAML (usually a comment or a key like `meta:`), never a fence.',
    '- Do not write long preambles, debates, or process notes in the final answer — emit the blocks.',
    '- If most questions were skipped: preserve template defaults + TODO comments; still emit BOTH full files.',
    '',
    'Directory exploration: only if references/, docs/, or root design .md files exist.',
    'If the topic is a fresh scaffold with no design docs, skip exploration and draft immediately from answers.',
    '',
    '--- METHODOLOGY: ONBOARDING.MD ---',
    methodologyBody,
    '--- END METHODOLOGY ---',
  ].join('\n');
}

export function composeUserPrompt(opts: RewriteOptions): string {
  const lines: string[] = [];
  const questionById = new Map(opts.onboarding.questions.map((q) => [q.id, q]));
  lines.push('# User answers');
  for (const a of opts.answers) {
    const q = questionById.get(a.questionId);
    lines.push('');
    lines.push(`## ${a.questionId} (${a.fieldId})`);
    if (q) {
      lines.push(`Question: ${q.question}`);
      if (q.field) lines.push(`Target: ${q.field}`);
    }
    if (a.kind === 'skipped') {
      lines.push('');
      lines.push('SKIPPED — preserve template default and append `# TODO: revisit after first few papers`.');
    } else {
      lines.push('');
      lines.push('Answer:');
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
  lines.push('Emit exactly two blocks, in this order, with these literal markers.');
  lines.push('Start the final answer with <<<PROJECT_YAML>>> on its own line — no intro paragraph.');
  lines.push('');
  lines.push('<<<PROJECT_YAML>>>');
  lines.push('...rewritten project.yaml content (must be valid YAML, NO ``` fences)...');
  lines.push('<<<END_PROJECT_YAML>>>');
  lines.push('');
  lines.push('<<<THESIS_MD>>>');
  lines.push('...rewritten thesis.md content (NO ``` fences)...');
  lines.push('<<<END_THESIS_MD>>>');
  lines.push('');
  lines.push('Again: final answer = only those two blocks (plus optional brief trailing note).');
  lines.push('The templates above are shown in fences only for readability in this prompt;');
  lines.push('your output blocks must be unfenced raw file contents.');
  return lines.join('\n');
}

/**
 * Models often wrap marker bodies in ```yaml / ```markdown fences (copying the
 * prompt's display style). Strip a single outer fence so YAML/MD parse sees the body.
 */
export function stripOuterMarkdownFence(body: string): string {
  const t = body.trim();
  const m = /^```(?:[a-zA-Z0-9_+-]*)?\r?\n([\s\S]*?)\r?\n```\s*$/.exec(t);
  return m ? m[1] : body;
}

export function parseResponse(output: string): { projectYaml: string; thesisMd: string } {
  const yamlMatch = /<<<PROJECT_YAML>>>\r?\n([\s\S]*?)\r?\n<<<END_PROJECT_YAML>>>/.exec(output);
  if (!yamlMatch) throw new Error('rewrite response: missing PROJECT_YAML block');
  const mdMatch = /<<<THESIS_MD>>>\r?\n([\s\S]*?)\r?\n<<<END_THESIS_MD>>>/.exec(output);
  if (!mdMatch) throw new Error('rewrite response: missing THESIS_MD block');
  const projectYaml = stripOuterMarkdownFence(yamlMatch[1]);
  const thesisMd = stripOuterMarkdownFence(mdMatch[1]);
  try {
    const parsed = parseYaml(projectYaml);
    if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
      throw new Error('rewrite response: project.yaml parsed to empty or non-object — likely blank block');
    }
  } catch (e) {
    if ((e as Error).message.startsWith('rewrite response:')) throw e;
    throw new Error(`rewrite response: project.yaml is not valid yaml — ${(e as Error).message}`);
  }
  return { projectYaml, thesisMd };
}
