import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { QuestionScreen } from '../../src/onboard/tui.js';
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
});
