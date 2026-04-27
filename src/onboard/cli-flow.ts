import readline from 'node:readline';
import type { Question } from './schema.js';
import type { SerializedAnswer } from './state.js';

export interface RunQuestionFlowOptions {
  rl: readline.Interface;
  output?: NodeJS.WritableStream;
  /** Optional pre-built async iterator over rl lines; created once and shared
   *  across multiple flow functions so readline events are not duplicated. */
  lines?: AsyncIterator<string>;
}

/**
 * Walk the user through each question via line-based prompts.
 * Empty input on optional questions = skip. Empty input on required questions
 * re-prompts. Multi-line paste arrives as a single line via readline because
 * the terminal is in cooked mode — much more robust than raw-mode handling.
 */
export async function runQuestionFlow(
  questions: Question[],
  opts: RunQuestionFlowOptions,
): Promise<SerializedAnswer[]> {
  const out = opts.output ?? process.stdout;
  const answers: SerializedAnswer[] = [];
  const lines = opts.lines ?? opts.rl[Symbol.asyncIterator]();

  for (const q of questions) {
    out.write('\n');
    out.write(`\x1b[1m${q.id} — ${q.fieldId}${q.required ? '' : ' (optional)'}\x1b[0m\n`);
    out.write(`${q.question}\n`);
    if (q.style) out.write(`\x1b[2mStyle: ${q.style}\x1b[0m\n`);
    if (q.examplesGood.length > 0) {
      out.write('\x1b[32mExamples (good):\x1b[0m\n');
      for (const e of q.examplesGood) out.write(`\x1b[32m  • ${e}\x1b[0m\n`);
    }
    if (q.examplesBad.length > 0) {
      out.write('\x1b[31mExamples (bad):\x1b[0m\n');
      for (const e of q.examplesBad) out.write(`\x1b[31m  • ${e}\x1b[0m\n`);
    }
    if (!q.required) {
      out.write('\x1b[2m(empty line to skip)\x1b[0m\n');
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      out.write('> ');
      const { value: raw, done } = await lines.next();
      const trimmed = (raw ?? '').trim();
      if (done || trimmed === '') {
        if (done) {
          // EOF — treat required as unanswered (return early) or skip optional
          if (!q.required) {
            answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'skipped' });
          }
          return answers;
        }
        if (!q.required) {
          answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'skipped' });
          break;
        }
        out.write('\x1b[33m(this question is required — please answer)\x1b[0m\n');
        continue;
      }
      answers.push({ questionId: q.id, fieldId: q.fieldId, kind: 'text', text: trimmed });
      break;
    }
  }

  return answers;
}

export type DiffAction = 'accept' | 'reanswer' | 'abort';

/**
 * Print before/after for project.yaml and thesis.md, then prompt for
 * single-key action. Use a line-based prompt rather than raw-mode for
 * paste-resistance.
 */
export async function runDiffReview(
  before: { projectYaml: string; thesisMd: string },
  after: { projectYaml: string; thesisMd: string },
  opts: RunQuestionFlowOptions,
): Promise<DiffAction> {
  const out = opts.output ?? process.stdout;
  out.write('\n');
  out.write('\x1b[1mReview rewritten files\x1b[0m\n\n');
  out.write('\x1b[36m─── project.yaml ───\x1b[0m\n');
  out.write(after.projectYaml);
  if (!after.projectYaml.endsWith('\n')) out.write('\n');
  out.write('\n\x1b[36m─── thesis.md ───\x1b[0m\n');
  out.write(after.thesisMd);
  if (!after.thesisMd.endsWith('\n')) out.write('\n');

  const lines = opts.lines ?? opts.rl[Symbol.asyncIterator]();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    out.write('\n[a]ccept / [r]e-answer / [x]abort: ');
    const { value: raw, done } = await lines.next();
    if (done) return 'abort'; // EOF → treat as abort
    const trimmed = (raw ?? '').trim().toLowerCase();
    if (trimmed === 'a' || trimmed === 'accept') return 'accept';
    if (trimmed === 'r' || trimmed === 'reanswer') return 'reanswer';
    if (trimmed === 'x' || trimmed === 'abort') return 'abort';
    out.write('please type a, r, or x\n');
  }
}
