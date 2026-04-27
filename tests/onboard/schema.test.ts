import { describe, it, expect } from 'vitest';
import { parseOnboardingMd } from '../../src/onboard/schema.js';

const VALID = `---
version: 1
target_files:
  - project.yaml
  - thesis.md
---

# Onboarding Questions

## Q1 — topic_oneline
Required: true
Field: project.yaml > meta.topic_oneline
Question: "What is the topic?"
Style: concrete.
Examples (good):
- "Decision policies in LLM agents."
Examples (bad):
- "AI."

## Q2 — research_questions
Required: true
Field: project.yaml > research_questions[]
Question: "List 2-4 questions."
Min: 2
Max: 4
Style: falsifiable.
`;

describe('parseOnboardingMd', () => {
  it('parses frontmatter and questions', () => {
    const r = parseOnboardingMd(VALID);
    expect(r.version).toBe(1);
    expect(r.targetFiles).toEqual(['project.yaml', 'thesis.md']);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toMatchObject({
      id: 'Q1',
      fieldId: 'topic_oneline',
      required: true,
      field: 'project.yaml > meta.topic_oneline',
      question: 'What is the topic?',
      style: 'concrete.',
      examplesGood: ['Decision policies in LLM agents.'],
      examplesBad: ['AI.'],
    });
    expect(r.questions[1]).toMatchObject({
      id: 'Q2',
      required: true,
      min: 2,
      max: 4,
    });
  });

  it('throws when version is not 1', () => {
    const bad = VALID.replace('version: 1', 'version: 2');
    expect(() => parseOnboardingMd(bad)).toThrow(/version/);
  });

  it('throws on missing Field line with location info', () => {
    const bad = VALID.replace('Field: project.yaml > meta.topic_oneline\n', '');
    expect(() => parseOnboardingMd(bad)).toThrow(/Q1.*Field/);
  });

  it('throws on missing required heading', () => {
    const bad = VALID.replace('Required: true\n', '');
    expect(() => parseOnboardingMd(bad)).toThrow(/Q1.*Required/);
  });

  it('throws on bad question header format', () => {
    const bad = VALID.replace('## Q1 — topic_oneline', '## Q1 topic_oneline');
    expect(() => parseOnboardingMd(bad)).toThrow(/header/);
  });

  it('preserves example list across blank lines between bullets', () => {
    const withBlank = VALID.replace(
      'Examples (good):\n- "Decision policies in LLM agents."',
      'Examples (good):\n- "Decision policies in LLM agents."\n\n- "Trace observability for AI agents."'
    );
    const r = parseOnboardingMd(withBlank);
    expect(r.questions[0].examplesGood).toEqual([
      'Decision policies in LLM agents.',
      'Trace observability for AI agents.',
    ]);
  });

  it('throws on non-numeric Min', () => {
    const bad = VALID.replace('Min: 2', 'Min: abc');
    expect(() => parseOnboardingMd(bad)).toThrow(/Min.*number/);
  });

  it('throws on non-canonical Required value', () => {
    const bad = VALID.replace('Required: true\nField: project.yaml > meta.topic_oneline', 'Required: yes\nField: project.yaml > meta.topic_oneline');
    expect(() => parseOnboardingMd(bad)).toThrow(/Required/);
  });
});
