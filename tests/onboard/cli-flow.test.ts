import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import readline from 'node:readline';
import { runQuestionFlow, runDiffReview } from '../../src/onboard/cli-flow.js';
import type { Question } from '../../src/onboard/schema.js';

function makeRl(input: string): { rl: readline.Interface; output: string[] } {
  const inputStream = Readable.from(input);
  const captured: string[] = [];
  const outputStream = new Writable({
    write(chunk, _enc, cb) { captured.push(chunk.toString()); cb(); },
  });
  const rl = readline.createInterface({ input: inputStream, output: outputStream, terminal: false });
  return { rl, output: captured };
}

const Q1: Question = {
  id: 'Q1', fieldId: 'topic_oneline', required: true,
  field: 'project.yaml > meta.topic_oneline',
  question: 'Describe topic.', examplesGood: ['good ex'], examplesBad: ['bad ex'],
};
const Q2: Question = {
  id: 'Q2', fieldId: 'taste', required: false,
  field: 'thesis.md > Taste',
  question: 'Taste?', examplesGood: [], examplesBad: [],
};

describe('runQuestionFlow', () => {
  it('records text answers and skips on empty for optional', async () => {
    const { rl, output } = makeRl('hello world\n\n');
    const answers = await runQuestionFlow([Q1, Q2], { rl, output: { write: (s: string) => { output.push(s); return true; } } as unknown as NodeJS.WritableStream });
    expect(answers).toEqual([
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'hello world' },
      { questionId: 'Q2', fieldId: 'taste', kind: 'skipped' },
    ]);
    rl.close();
  });

  it('re-prompts when required question gets empty input', async () => {
    const { rl } = makeRl('\n\nfinally an answer\n');
    const captured: string[] = [];
    const answers = await runQuestionFlow([Q1], {
      rl,
      output: { write: (s: string) => { captured.push(s); return true; } } as unknown as NodeJS.WritableStream,
    });
    expect(answers).toEqual([
      { questionId: 'Q1', fieldId: 'topic_oneline', kind: 'text', text: 'finally an answer' },
    ]);
    expect(captured.join('')).toMatch(/required/);
    rl.close();
  });

  it('preserves a multi-line paste as one trimmed answer', async () => {
    // readline reads up to newline; the user's paste with embedded \n would
    // be delivered as multiple readline lines. But a single line of pasted
    // text comes through intact regardless of length.
    const longLine = 'sentence one. sentence two. sentence three.';
    const { rl } = makeRl(`${longLine}\n`);
    const captured: string[] = [];
    const answers = await runQuestionFlow([Q1], {
      rl,
      output: { write: (s: string) => { captured.push(s); return true; } } as unknown as NodeJS.WritableStream,
    });
    expect(answers[0]).toMatchObject({ kind: 'text', text: longLine });
    rl.close();
  });
});

describe('runDiffReview', () => {
  it('returns "accept" on a/A', async () => {
    const { rl } = makeRl('a\n');
    const captured: string[] = [];
    const r = await runDiffReview(
      { projectYaml: 'b', thesisMd: 'b' },
      { projectYaml: 'NEW', thesisMd: 'NEW' },
      { rl, output: { write: (s: string) => { captured.push(s); return true; } } as unknown as NodeJS.WritableStream }
    );
    expect(r).toBe('accept');
    expect(captured.join('')).toContain('NEW');
    rl.close();
  });

  it('returns "reanswer" on r', async () => {
    const { rl } = makeRl('r\n');
    const r = await runDiffReview(
      { projectYaml: '', thesisMd: '' },
      { projectYaml: '', thesisMd: '' },
      { rl, output: { write: () => true } as unknown as NodeJS.WritableStream }
    );
    expect(r).toBe('reanswer');
    rl.close();
  });

  it('returns "abort" on x', async () => {
    const { rl } = makeRl('x\n');
    const r = await runDiffReview(
      { projectYaml: '', thesisMd: '' },
      { projectYaml: '', thesisMd: '' },
      { rl, output: { write: () => true } as unknown as NodeJS.WritableStream }
    );
    expect(r).toBe('abort');
    rl.close();
  });

  it('re-prompts on invalid input', async () => {
    const { rl } = makeRl('bogus\na\n');
    const captured: string[] = [];
    const r = await runDiffReview(
      { projectYaml: '', thesisMd: '' },
      { projectYaml: '', thesisMd: '' },
      { rl, output: { write: (s: string) => { captured.push(s); return true; } } as unknown as NodeJS.WritableStream }
    );
    expect(r).toBe('accept');
    expect(captured.join('')).toMatch(/please type/);
    rl.close();
  });
});
