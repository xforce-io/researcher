import { VERSION } from '../version.js';

export function printVersion(): void {
  process.stdout.write(`${VERSION}\n`);
}
