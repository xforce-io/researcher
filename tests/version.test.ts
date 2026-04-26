import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version.js';

describe('version', () => {
  it('exports a semver-shaped string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
