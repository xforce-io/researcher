import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import readline from 'node:readline';
import {
  resolvePackageRoot,
  resolveProjectResearcherDir,
  resolveResearcherHome,
} from '../paths.js';
import { scaffoldTopicRepo, validateRepoRoot } from './init.js';
import { ClaudeCodeAdapter } from '../adapter/claude-code.js';
import type { AgentRuntime } from '../adapter/interface.js';
import { parseOnboardingMd } from '../onboard/schema.js';
import { isAllTemplates } from '../onboard/all-templates-check.js';
import {
  rewriteAnswers,
  composeUserPrompt,
  composeSystemPrompt,
} from '../onboard/rewrite.js';
import { writeOnboardArtifacts, writeRunLog, makeSlug } from '../onboard/persist.js';
import { OnboardingState } from '../onboard/state.js';
import { runQuestionFlow, runDiffReview } from '../onboard/cli-flow.js';
import type { SerializedAnswer } from '../onboard/state.js';

export interface OnboardOptions {
  cwd: string;
  /** Test-only: bypass interactive flow and feed answers directly. */
  answersOverride?: SerializedAnswer[];
  /** Test-only: auto-accept diff review. */
  autoAcceptDiff?: boolean;
}

export async function runOnboard(opts: OnboardOptions): Promise<void> {
  preFlight();
  const repoRoot = validateRepoRoot(opts.cwd);

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
  const state = new OnboardingState(onboarding.questions);

  // ===== Test path: bypass interactive flow =====
  if (opts.answersOverride) {
    for (const a of opts.answersOverride) {
      if (a.kind === 'text' && a.text !== undefined) state.answer(a.questionId, a.text);
      else state.skip(a.questionId);
    }
    const result = await rewriteOrLog(
      runtime, repoRoot, onboardingMd, onboarding,
      state.serialize(), templateProjectYaml, templateThesisMd
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

  // ===== Real path: readline-based flow =====
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const sigintHandler = (): void => {
    try {
      writeRunLog({
        repoRoot,
        answers: state.serialize(),
        prompt: '',
        response: '',
        result: { status: 'user_aborted' },
      });
    } catch {
      // best-effort; don't mask the abort
    }
    rl.close();
    process.exit(130);
  };
  process.once('SIGINT', sigintHandler);
  // readline emits 'SIGINT' on Ctrl-C when terminal:true; forward to our handler
  rl.on('SIGINT', () => process.emit('SIGINT'));

  try {
    // Create a single async iterator over readline lines, shared across all
    // prompting functions so each line is consumed exactly once.
    const lines = rl[Symbol.asyncIterator]();

    // Outer loop allows the diff-review re-answer path to restart from Q1
    let committed = false;
    let aborted = false;
    while (!committed && !aborted) {
      // Reset state for each pass through the question loop
      state.reset();
      const answers = await runQuestionFlow(onboarding.questions, { rl, lines });
      // Mirror answers into OnboardingState for SIGINT log + serialize() consistency
      for (const a of answers) {
        if (a.kind === 'text' && a.text !== undefined) state.answer(a.questionId, a.text);
        else state.skip(a.questionId);
      }

      const result = await rewriteOrLog(
        runtime, repoRoot, onboardingMd, onboarding,
        state.serialize(), templateProjectYaml, templateThesisMd
      );

      const action = await runDiffReview(
        { projectYaml: templateProjectYaml, thesisMd: templateThesisMd },
        { projectYaml: result.projectYaml, thesisMd: result.thesisMd },
        { rl, lines }
      );

      if (action === 'accept') {
        const q1 = answers.find((a) => a.questionId === 'Q1');
        const topicOneline = q1?.kind === 'text' ? q1.text ?? '' : '';
        await writeOnboardArtifacts({
          repoRoot,
          projectYaml: result.projectYaml,
          thesisMd: result.thesisMd,
          slug: makeSlug(topicOneline),
        });
        if (result.projectYaml.includes('your topic keyword')) {
          process.stdout.write(
            `\n\x1b[33m⚠️  arxiv keywords not set (Q6 was skipped).\x1b[0m\n` +
            `   Autodiscovery disabled until you fill in .researcher/project.yaml sources[].queries.\n` +
            `   You can still add papers manually: \`researcher add <arxiv-id>\`\n`
          );
        }
        committed = true;
      } else if (action === 'abort') {
        aborted = true;
      }
      // 'reanswer' falls through to next iteration
    }

    if (committed) {
      await maybeFirstPaper(rl, lines, repoRoot);
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    rl.close();
  }
}

async function rewriteOrLog(
  runtime: AgentRuntime,
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

function preFlight(): void {
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

async function maybeFirstPaper(
  _rl: readline.Interface,
  lines: AsyncIterator<string>,
  repoRoot: string
): Promise<void> {
  process.stdout.write('\nfeed first arxiv id now? (paste id or press enter to skip): ');
  const { value: raw, done } = await lines.next();
  const id = done ? '' : (raw ?? '').trim();
  if (!id) {
    process.stdout.write('\nonboarded. next: `researcher add <arxiv-id>`\n');
    return;
  }
  const { runAdd } = await import('./add.js');
  await runAdd({ input: id, cwd: repoRoot });
}
