import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { QuestionScreen, DiffReview, App } from '../../src/onboard/tui.js';
import type { Question } from '../../src/onboard/schema.js';

const Q: Question = {
  id: 'Q1', fieldId: 'topic_oneline', required: true,
  field: 'project.yaml > meta.topic_oneline',
  question: 'Describe your topic in one sentence.',
  style: 'concrete',
  examplesGood: ['Decision policies in LLM agents.'],
  examplesBad: ['AI agents.'],
};

describe('<QuestionScreen>', () => {
  it('renders question, examples, and a free-text prompt', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { lastFrame } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    const out = lastFrame();
    expect(out).toContain('Q1');
    expect(out).toContain('Describe your topic');
    expect(out).toContain('Decision policies in LLM agents.');
    expect(out).toContain('Examples (bad)');
  });

  it('calls onSubmit with typed text on Enter', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { stdin } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    stdin.write('hello world');
    stdin.write('\r'); // Enter
    expect(onSubmit).toHaveBeenCalledWith('hello world');
  });

  it('does not allow skip for required question', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { lastFrame, stdin } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    expect(lastFrame()).not.toContain('skip');
    stdin.write(''); // Esc
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('allows skip for optional question via Esc', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const optional: Question = { ...Q, required: false };
    const { lastFrame, stdin } = render(
      <QuestionScreen question={optional} onSubmit={onSubmit} onSkip={onSkip} />
    );
    expect(lastFrame()).toContain('skip');
    stdin.write(''); // Esc
    expect(onSkip).toHaveBeenCalled();
  });

  it('trims whitespace before submitting', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { stdin } = render(
      <QuestionScreen question={Q} onSubmit={onSubmit} onSkip={onSkip} />
    );
    stdin.write('  spaced  ');
    stdin.write('\r');
    expect(onSubmit).toHaveBeenCalledWith('spaced');
  });
});

describe('<DiffReview>', () => {
  const before = { projectYaml: 'old yaml', thesisMd: 'old thesis' };
  const after = { projectYaml: 'NEW yaml', thesisMd: 'NEW thesis' };

  it('renders both file diffs', () => {
    const { lastFrame } = render(
      <DiffReview before={before} after={after} onAccept={() => {}} onReanswer={() => {}} onAbort={() => {}} />
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('project.yaml');
    expect(out).toContain('thesis.md');
    expect(out).toContain('NEW yaml');
  });

  it('calls onAccept on "a"', () => {
    const onAccept = vi.fn();
    const { stdin } = render(
      <DiffReview before={before} after={after} onAccept={onAccept} onReanswer={() => {}} onAbort={() => {}} />
    );
    stdin.write('a');
    expect(onAccept).toHaveBeenCalled();
  });

  it('calls onAbort on "x"', () => {
    const onAbort = vi.fn();
    const { stdin } = render(
      <DiffReview before={before} after={after} onAccept={() => {}} onReanswer={() => {}} onAbort={onAbort} />
    );
    stdin.write('x');
    expect(onAbort).toHaveBeenCalled();
  });
});

describe('<App>', () => {
  const questions: Question[] = [
    { id: 'Q1', fieldId: 'topic_oneline', required: true, field: 'f', question: 'q1?', examplesGood: [], examplesBad: [] },
    { id: 'Q2', fieldId: 'taste', required: false, field: 'f', question: 'q2?', examplesGood: [], examplesBad: [] },
  ];

  it('walks all questions then calls onAllAnswered with serialized answers', async () => {
    const onAllAnswered = vi.fn(async () => ({
      before: { projectYaml: 'b', thesisMd: 'b' },
      after: { projectYaml: 'a', thesisMd: 'a' },
    }));
    const { stdin } = render(
      <App questions={questions} onAllAnswered={onAllAnswered} onCommit={() => {}} onAbort={() => {}} />
    );
    stdin.write('first answer');
    stdin.write('\r'); // submit Q1
    stdin.write('\x1b'); // skip Q2 via Esc
    await new Promise((r) => setTimeout(r, 50));
    expect(onAllAnswered).toHaveBeenCalled();
    const arg = onAllAnswered.mock.calls[0][0];
    expect(arg).toEqual([
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'first answer' },
      { questionId: 'Q2', fieldId: 'taste', kind: 'skipped' },
    ]);
  });

  it('calls onCommit with rewritten content on accept', async () => {
    const onCommit = vi.fn();
    const { stdin } = render(
      <App
        questions={questions}
        onAllAnswered={async () => ({
          before: { projectYaml: 'b', thesisMd: 'b' },
          after: { projectYaml: 'a', thesisMd: 'a' },
        })}
        onCommit={onCommit}
        onAbort={() => {}}
      />
    );
    stdin.write('answer');
    stdin.write('\r');
    stdin.write('\x1b'); // skip Q2
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('a'); // accept in DiffReview
    expect(onCommit).toHaveBeenCalledWith(
      { projectYaml: 'a', thesisMd: 'a' },
      'answer'
    );
  });
});
