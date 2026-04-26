import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolvePackageRoot, resolveResearcherHome } from '../paths.js';

const FILES = [
  '01-reading.md',
  '02-source.md',
  '03-filtering.md',
  '04-synthesis.md',
  '05-verification.md',
  '06-writing.md',
  '07-cadence.md',
];

export async function runMethodologyInstall(): Promise<void> {
  const src = join(resolvePackageRoot(), 'methodology');
  const dst = join(resolveResearcherHome(), 'methodology');
  mkdirSync(dst, { recursive: true });
  let copied = 0, skipped = 0;
  for (const f of FILES) {
    const s = join(src, f), d = join(dst, f);
    if (existsSync(d) && readFileSync(s).equals(readFileSync(d))) {
      skipped++;
      continue;
    }
    copyFileSync(s, d);
    copied++;
  }
  process.stdout.write(`installed methodology to ${dst} (copied ${copied}, skipped ${skipped})\n`);
}

export async function runMethodologyShow(): Promise<string> {
  const dir = join(resolveResearcherHome(), 'methodology');
  if (!existsSync(dir)) {
    process.stdout.write(`no methodology installed; run \`researcher methodology install\`\n`);
    return '';
  }
  const lines: string[] = [];
  for (const f of readdirSync(dir).sort()) {
    const lc = readFileSync(join(dir, f), 'utf8').split('\n').length;
    lines.push(`${f}\t${lc}`);
  }
  const out = lines.join('\n') + '\n';
  process.stdout.write(out);
  return out;
}

export async function runMethodologyEdit(name: string): Promise<void> {
  const target = join(resolveResearcherHome(), 'methodology', name);
  if (!existsSync(target)) throw new Error(`no such methodology file: ${name}`);
  const editor = process.env.EDITOR ?? 'vi';
  await execa(editor, [target], { stdio: 'inherit' });
}
