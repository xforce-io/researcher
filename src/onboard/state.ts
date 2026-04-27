import type { Question } from './schema.js';

export type Answer = { kind: 'text'; text: string } | { kind: 'skipped' };

export interface SerializedAnswer {
  questionId: string;
  fieldId: string;
  kind: 'text' | 'skipped';
  text?: string;
}

export class OnboardingState {
  private readonly questions: Map<string, Question>;
  private readonly answers = new Map<string, Answer>();

  constructor(questions: Question[]) {
    this.questions = new Map(questions.map((q) => [q.id, q]));
  }

  answer(id: string, text: string): void {
    this.requireQuestion(id);
    this.answers.set(id, { kind: 'text', text });
  }

  skip(id: string): void {
    const q = this.requireQuestion(id);
    if (q.required) throw new Error(`cannot skip required question ${id}`);
    this.answers.set(id, { kind: 'skipped' });
  }

  getAnswer(id: string): Answer | undefined {
    return this.answers.get(id);
  }

  unansweredRequired(): string[] {
    const out: string[] = [];
    for (const q of this.questions.values()) {
      if (q.required && !this.answers.has(q.id)) out.push(q.id);
    }
    return out;
  }

  serialize(): SerializedAnswer[] {
    const out: SerializedAnswer[] = [];
    for (const q of this.questions.values()) {
      const a = this.answers.get(q.id);
      if (!a) continue;
      out.push(
        a.kind === 'text'
          ? { questionId: q.id, fieldId: q.fieldId, kind: 'text', text: a.text }
          : { questionId: q.id, fieldId: q.fieldId, kind: 'skipped' }
      );
    }
    return out;
  }

  private requireQuestion(id: string): Question {
    const q = this.questions.get(id);
    if (!q) throw new Error(`unknown question id: ${id}`);
    return q;
  }
}
