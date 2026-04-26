import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackageRoot } from './paths.js';

const pkg = JSON.parse(
  readFileSync(join(resolvePackageRoot(), 'package.json'), 'utf8'),
) as { version: string };

export const VERSION = pkg.version;
