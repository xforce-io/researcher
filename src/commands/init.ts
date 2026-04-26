import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

export interface InitOptions {
  targetDir: string;
}

function gitToplevel(dir: string): string | null {
  try {
    const { stdout } = execaSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function runInit(opts: InitOptions): Promise<void> {
  const target = resolveProjectResearcherDir(opts.targetDir);
  if (existsSync(target)) {
    throw new Error(`${target} already exists`);
  }
  const toplevel = gitToplevel(opts.targetDir);
  if (toplevel === null) {
    throw new Error(
      `${opts.targetDir} is not inside a git repo (run \`git init\` first)`
    );
  }
  // realpath both sides — on macOS /tmp -> /private/tmp etc., and git canonicalizes.
  const targetReal = realpathSync(opts.targetDir);
  if (targetReal !== toplevel) {
    throw new Error(
      `init must be run at the repo root (${toplevel}), not ${targetReal}`
    );
  }
  const pkg = resolvePackageRoot();
  mkdirSync(join(target, 'state'), { recursive: true });
  copyFileSync(
    join(pkg, 'templates/project.yaml'),
    join(target, 'project.yaml')
  );
  copyFileSync(
    join(pkg, 'templates/thesis.md'),
    join(target, 'thesis.md')
  );
  copyFileSync(
    join(pkg, 'templates/researcher-gitignore'),
    join(target, '.gitignore')
  );
  writeFileSync(join(target, 'state/seen.jsonl'), '');

  process.stdout.write(`initialized ${target}\n`);
  process.stdout.write(`next steps:\n`);
  process.stdout.write(
    `  1. edit .researcher/project.yaml — declare your research questions and sources\n`
  );
  process.stdout.write(
    `  2. edit .researcher/thesis.md — state your working thesis\n`
  );
  process.stdout.write(
    `  3. run \`researcher methodology install\` once globally to install methodology\n`
  );
  process.stdout.write(
    `  4. then \`researcher add <arxiv_id>\` to ingest your first paper\n`
  );
}
