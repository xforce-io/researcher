import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../src/prompts/load.js';

describe('renderTemplate', () => {
  it('substitutes simple keys', () => {
    expect(renderTemplate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });
  it('throws when a placeholder has no value', () => {
    expect(() => renderTemplate('hi {{x}}', {})).toThrow(/x/);
  });
  it('leaves non-template braces alone', () => {
    expect(renderTemplate('{x}', {})).toBe('{x}');
  });
});
