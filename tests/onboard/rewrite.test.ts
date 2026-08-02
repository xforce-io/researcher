import { describe, it, expect, vi } from 'vitest';
import { parseResponse, rewriteAnswers, stripOuterMarkdownFence } from '../../src/onboard/rewrite.js';
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

  it('accepts marker bodies wrapped in markdown code fences (common model habit)', async () => {
    // Live failure mode (agentic-model-training Complete setup): model echoed
    // prompt display style and put ```yaml / ```markdown around each body.
    const fenced = `<<<PROJECT_YAML>>>
\`\`\`yaml
meta:
  topic_oneline: "agentic model training领域进展研究"
  language: zh
research_questions:
  - id: RQ1
    text: "How is SOTA defined for agentic model training?"
\`\`\`
<<<END_PROJECT_YAML>>>

<<<THESIS_MD>>>
\`\`\`markdown
# Thesis
## Working thesis
Agentic model training is advancing via ...
\`\`\`
<<<END_THESIS_MD>>>
`;
    const rt = fakeRuntime(fenced);
    const r = await rewriteAnswers({
      runtime: rt, cwd: '/tmp', methodologyBody: 's',
      onboarding: ONBOARDING, answers: [],
      templateProjectYaml: '', templateThesisMd: '',
    });
    expect(r.projectYaml).toContain('agentic model training');
    expect(r.projectYaml).not.toMatch(/^```/);
    expect(r.thesisMd).toContain('Working thesis');
    expect(r.thesisMd).not.toMatch(/^```/);
  });

  it('rejects thesis that is still instructional scaffold / template echo', async () => {
    const hollowThesis = [
      '# Thesis',
      '',
      '## Working thesis',
      '',
      'Write one paragraph per major claim — typically one per research question.',
      '',
      '<!-- TODO: revisit after first few papers — working hypotheses for RQ1/RQ2 not yet stated -->',
      '',
      '## Taste',
      '',
      'What counts as a good paper here? What does a bad one look like?',
      '',
      '## Anti-patterns',
      '',
      'What do you intentionally reject? Examples:',
      '',
      '## Examples',
      '',
      'Pointers to existing notes that exemplify good or bad inclusion decisions.',
      '',
    ].join('\n');
    const hollow = [
      '<<<PROJECT_YAML>>>',
      'meta:',
      '  topic_oneline: "model inference"',
      'research_questions: []',
      '<<<END_PROJECT_YAML>>>',
      '',
      '<<<THESIS_MD>>>',
      hollowThesis,
      '<<<END_THESIS_MD>>>',
      '',
    ].join('\n');
    const rt = fakeRuntime(hollow);
    await expect(
      rewriteAnswers({
        runtime: rt, cwd: '/tmp', methodologyBody: 's',
        onboarding: ONBOARDING, answers: [],
        templateProjectYaml: '', templateThesisMd: '',
      }),
    ).rejects.toThrow(/template\/hollow/i);
  });
});

describe('stripOuterMarkdownFence', () => {
  it('strips a single outer fence with language tag', () => {
    expect(stripOuterMarkdownFence('```yaml\nmeta:\n  x: 1\n```')).toBe('meta:\n  x: 1');
  });

  it('leaves unfenced body unchanged (including internal fences)', () => {
    const body = 'meta:\n  x: 1\n# see ```example``` inline';
    expect(stripOuterMarkdownFence(body)).toBe(body);
  });
});

describe('parseResponse', () => {
  it('parses unfenced blocks', () => {
    const r = parseResponse(VALID_RESPONSE);
    expect(r.projectYaml).toContain('Decision policies');
    expect(r.thesisMd).toContain('Working thesis');
  });
});
