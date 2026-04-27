import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import React from 'react';
import { render } from 'ink';
import { resolvePackageRoot, resolveProjectResearcherDir, resolveResearcherHome } from '../paths.js';
import { scaffoldTopicRepo, validateRepoRoot } from './init.js';
import { ClaudeCodeAdapter } from '../adapter/claude-code.js';
import type { AgentRuntime } from '../adapter/interface.js';
import { parseOnboardingMd } from '../onboard/schema.js';
import { isAllTemplates } from '../onboard/all-templates-check.js';
import { rewriteAnswers, composeUserPrompt, composeSystemPrompt } from '../onboard/rewrite.js';
import { writeOnboardArtifacts, writeRunLog, makeSlug } from '../onboard/persist.js';
import { App } from '../onboard/tui.js';
import { OnboardingState, type SerializedAnswer } from '../onboard/state.js';

export interface OnboardOptions {
  cwd: string;
  /** Test-only: bypass TUI and feed answers directly. */
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

  // Test path: bypass TUI
  if (opts.answersOverride) {
    const result = await rewriteOrLog(
      runtime, repoRoot, onboardingMd, onboarding,
      opts.answersOverride, templateProjectYaml, templateThesisMd
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

  // Real path: render TUI
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
    process.exit(130);
  };
  process.once('SIGINT', sigintHandler);

  try {
    await new Promise<void>((resolve) => {
      const ink = render(
        React.createElement(App, {
          questions: onboarding.questions,
          state,
          onAllAnswered: async (answers) => {
            const r = await rewriteOrLog(
              runtime, repoRoot, onboardingMd, onboarding,
              answers, templateProjectYaml, templateThesisMd
            );
            return {
              before: { projectYaml: templateProjectYaml, thesisMd: templateThesisMd },
              after: { projectYaml: r.projectYaml, thesisMd: r.thesisMd },
            };
          },
        onCommit: (rewritten, topicOneline) => {
          void (async () => {
            try {
              await writeOnboardArtifacts({
                repoRoot,
                projectYaml: rewritten.projectYaml,
                thesisMd: rewritten.thesisMd,
                slug: makeSlug(topicOneline),
              });
              ink.unmount();
              await maybeFirstPaper(repoRoot);
            } catch (e) {
              ink.unmount();
              process.stderr.write(`onboard commit failed: ${(e as Error).message}\n`);
            }
            resolve();
          })();
        },
        onAbort: () => {
          ink.unmount();
          resolve();
        },
      })
    );
  });
  } finally {
    process.removeListener('SIGINT', sigintHandler);
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

async function maybeFirstPaper(repoRoot: string): Promise<void> {
  process.stdout.write('\nfeed first arxiv id now? (paste id or press enter to skip): ');
  const id = await readStdinLine();
  if (!id) {
    process.stdout.write('\nonboarded. next: `researcher add <arxiv-id>`\n');
    return;
  }
  const { runAdd } = await import('./add.js');
  await runAdd({ input: id, cwd: repoRoot });
}

function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk: string | Buffer): void => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (buf.includes('\n')) {
        process.stdin.removeListener('data', onData);
        resolve(buf.trim());
      }
    };
    process.stdin.on('data', onData);
  });
}
