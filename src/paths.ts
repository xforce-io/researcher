import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveResearcherHome(): string {
  return process.env.RESEARCHER_HOME ?? join(homedir(), '.researcher');
}

export function resolveProjectResearcherDir(projectRoot: string): string {
  return join(projectRoot, '.researcher');
}

export function resolvePackageRoot(): string {
  // src/paths.ts → dist/paths.js at runtime; package root is two levels up
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}
