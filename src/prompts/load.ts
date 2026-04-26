import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackageRoot } from '../paths.js';

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    if (!(k in vars)) throw new Error(`template missing value for ${k}`);
    return vars[k];
  });
}

export function loadPromptTemplate(name: string): string {
  return readFileSync(join(resolvePackageRoot(), 'prompts', name), 'utf8');
}
