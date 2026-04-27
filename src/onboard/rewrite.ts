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
    "Rewrite the user's rough answers into the topic's project.yaml and thesis.md.",
    'Follow the style guide below verbatim. Preserve user intent. Do not invent facts.',
    '',
    'IMPORTANT: Before drafting the output, explore the working directory.',
    'Read any design documents, specs, roadmaps, or prior notes you find — especially',
    'files in references/, docs/, or any .md files at the repo root. Use what you find',
    'to write a substantive thesis grounded in the actual project context, not just the',
    'user\'s brief answers. If the project has no such files, rely only on the answers.',
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

export function parseResponse(output: string): { projectYaml: string; thesisMd: string } {
  const yamlMatch = /<<<PROJECT_YAML>>>\r?\n([\s\S]*?)\r?\n<<<END_PROJECT_YAML>>>/.exec(output);
  if (!yamlMatch) throw new Error('rewrite response: missing PROJECT_YAML block');
  const mdMatch = /<<<THESIS_MD>>>\r?\n([\s\S]*?)\r?\n<<<END_THESIS_MD>>>/.exec(output);
  if (!mdMatch) throw new Error('rewrite response: missing THESIS_MD block');
  const projectYaml = yamlMatch[1];
  const thesisMd = mdMatch[1];
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
