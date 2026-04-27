import { describe, it, expect, vi } from 'vitest';
import { rewriteAnswers } from '../../src/onboard/rewrite.js';
import type { Onboarding } from '../../src/onboard/schema.js';
import type { AgentRuntime, InvokeResult } from '../../src/adapter/interface.js';
import type { SerializedAnswer } from '../../src/onboard/state.js';

const ONBOARDING: Onboarding = {
  version: 1,
  targetFiles: ['project.yaml', 'thesis.md'],
  questions: [
    {
      id: 'Q1', fieldId: 'topic_oneline', required: true,
      field: 'project.yaml > meta.topic_oneline',
      question: 'topic?', examplesGood: [], examplesBad: [],
    },
  ],
};

function fakeRuntime(output: string): AgentRuntime {
  return {
    id: 'fake',
    invoke: vi.fn(async (): Promise<InvokeResult> => ({
      output, exitCode: 0, modifiedFiles: [],
    })),
  };
}

const VALID_RESPONSE = `Some commentary.

<<<PROJECT_YAML>>>
meta:
  topic_oneline: "Decision policies."
research_questions: []
<<<END_PROJECT_YAML>>>

<<<THESIS_MD>>>
# Thesis
## Working thesis
A test thesis.
<<<END_THESIS_MD>>>
`;

describe('rewriteAnswers', () => {
  it('builds prompt and parses two-block response', async () => {
    const rt = fakeRuntime(VALID_RESPONSE);
    const answers: SerializedAnswer[] = [
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'decision policies' },
    ];
    const r = await rewriteAnswers({
      runtime: rt,
      cwd: '/tmp',
      methodologyBody: 'STYLE GUIDE',
      onboarding: ONBOARDING,
      answers,
      templateProjectYaml: 'meta:\n  topic_oneline: ""\n',
      templateThesisMd: '# Thesis\n',
    });
    expect(r.projectYaml).toContain('Decision policies');
    expect(r.thesisMd).toContain('Working thesis');

    const call = (rt.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.userPrompt).toContain('Q1');
    expect(call.userPrompt).toContain('topic?');  // the question text from ONBOARDING.questions[0]
    expect(call.userPrompt).toContain('decision policies');
    expect(call.systemPrompt).toContain('STYLE GUIDE');
  });

  it('throws when response is missing PROJECT_YAML block', async () => {
    const rt = fakeRuntime('only commentary, no blocks');
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/PROJECT_YAML/);
  });

  it('throws when project.yaml block fails YAML parsing', async () => {
    const bad = VALID_RESPONSE.replace(
      'meta:\n  topic_oneline: "Decision policies."',
      'meta:\n  topic_oneline: "unterminated'
    );
    const rt = fakeRuntime(bad);
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/yaml/i);
  });

  it('throws when adapter returns non-zero exit', async () => {
    const rt: AgentRuntime = {
      id: 'fake',
      invoke: async () => ({ output: '', exitCode: 1, modifiedFiles: [] }),
    };
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/exit code 1/);
  });

  it('throws when response is missing THESIS_MD block', async () => {
    const noThesis = VALID_RESPONSE.replace(/<<<THESIS_MD>>>[\s\S]*<<<END_THESIS_MD>>>/, '');
    const rt = fakeRuntime(noThesis);
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/THESIS_MD/);
  });

  it('handles CRLF line endings in response', async () => {
    const crlf = VALID_RESPONSE.replace(/\n/g, '\r\n');
    const rt = fakeRuntime(crlf);
    const r = await rewriteAnswers({
      runtime: rt, cwd: '/tmp', methodologyBody: 's',
      onboarding: ONBOARDING, answers: [],
      templateProjectYaml: '', templateThesisMd: '',
    });
    expect(r.projectYaml).toContain('Decision policies');
    expect(r.thesisMd).toContain('Working thesis');
  });

  it('throws when project.yaml block is empty', async () => {
    const empty = VALID_RESPONSE.replace(
      /<<<PROJECT_YAML>>>[\s\S]*?<<<END_PROJECT_YAML>>>/,
      '<<<PROJECT_YAML>>>\n\n<<<END_PROJECT_YAML>>>'
    );
    const rt = fakeRuntime(empty);
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      })
    ).rejects.toThrow(/empty|non-object|blank/);
  });
});
