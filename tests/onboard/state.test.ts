import { describe, it, expect } from 'vitest';
import { OnboardingState } from '../../src/onboard/state.js';
import type { Question } from '../../src/onboard/schema.js';

const Q1: Question = {
  id: 'Q1', fieldId: 'topic_oneline', required: true, field: 'project.yaml > meta.topic_oneline',
  question: 'topic?', examplesGood: [], examplesBad: [],
};
const Q2: Question = {
  id: 'Q2', fieldId: 'taste', required: false, field: 'thesis.md > Taste',
  question: 'taste?', examplesGood: [], examplesBad: [],
};

describe('OnboardingState', () => {
  it('records a free-text answer', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.answer('Q1', 'Decision policies in LLM agents.');
    expect(s.getAnswer('Q1')).toEqual({ kind: 'text', text: 'Decision policies in LLM agents.' });
  });

  it('marks an optional question as skipped', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.skip('Q2');
    expect(s.getAnswer('Q2')).toEqual({ kind: 'skipped' });
  });

  it('refuses to skip a required question', () => {
    const s = new OnboardingState([Q1, Q2]);
    expect(() => s.skip('Q1')).toThrow(/required/);
  });

  it('reports unanswered required questions', () => {
    const s = new OnboardingState([Q1, Q2]);
    expect(s.unansweredRequired()).toEqual(['Q1']);
    s.answer('Q1', 'x');
    expect(s.unansweredRequired()).toEqual([]);
  });

  it('serializes answers for prompt and run-log', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.answer('Q1', 'topic.');
    s.skip('Q2');
    expect(s.serialize()).toEqual([
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'topic.' },
      { questionId: 'Q2', fieldId: 'taste', kind: 'skipped' },
    ]);
  });

  it('reset() clears all answers but preserves question set', () => {
    const s = new OnboardingState([Q1, Q2]);
    s.answer('Q1', 'topic.');
    s.skip('Q2');
    s.reset();
    expect(s.getAnswer('Q1')).toBeUndefined();
    expect(s.getAnswer('Q2')).toBeUndefined();
    expect(s.unansweredRequired()).toEqual(['Q1']);
    // can answer again after reset
    s.answer('Q1', 'new topic');
    expect(s.getAnswer('Q1')).toEqual({ kind: 'text', text: 'new topic' });
  });
});
