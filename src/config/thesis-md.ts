import { readFileSync } from 'node:fs';

export class ThesisError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
    this.name = 'ThesisError';
  }
}

export interface Thesis {
  body: string;
  sections: Map<string, string>;
}

const REQUIRED = ['Working thesis', 'Taste', 'Anti-patterns', 'Examples'];

export function loadThesis(path: string): Thesis {
  const body = readFileSync(path, 'utf8');
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) sections.set(current, buf.join('\n').trim());
    buf = [];
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  for (const r of REQUIRED) {
    if (!sections.has(r)) {
      throw new ThesisError(`missing required section "${r}" in ${path}`, path);
    }
  }
  return { body, sections };
}
