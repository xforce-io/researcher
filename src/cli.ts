#!/usr/bin/env node
import { Command } from 'commander';
import { VERSION } from './version.js';
import { printVersion } from './commands/version.js';

const program = new Command();
program.name('researcher').description('Per-topic research CLI').version(VERSION);
program
  .command('version')
  .description('Print version')
  .action(() => printVersion());
program
  .command('init')
  .description('Scaffold .researcher/ in the current topic repo')
  .action(async () => {
    const { runInit } = await import('./commands/init.js');
    await runInit({ targetDir: process.cwd() });
  });

const methodology = program.command('methodology').description('Manage researcher methodology files');
methodology.command('install').action(async () => (await import('./commands/methodology.js')).runMethodologyInstall());
methodology.command('show').action(async () => { await (await import('./commands/methodology.js')).runMethodologyShow(); });
methodology.command('edit <name>').action(async (name: string) => (await import('./commands/methodology.js')).runMethodologyEdit(name));

program
  .command('add <input>')
  .description('Manually add a paper (arxiv id or http(s) URL) to the current topic')
  .action(async (input: string) => {
    const { runAdd } = await import('./commands/add.js');
    await runAdd({ input, cwd: process.cwd() });
  });

program
  .command('read <input>')
  .description('Deep-read a paper into notes/pending without synthesis')
  .action(async (input: string) => {
    const { runRead } = await import('./commands/read.js');
    await runRead({ input, cwd: process.cwd() });
  });

program
  .command('onboard')
  .description('Interactive TUI to scaffold and fill in a new topic')
  .action(async () => {
    const { runOnboard } = await import('./commands/onboard.js');
    await runOnboard({ cwd: process.cwd() });
  });

program
  .command('migrate-notes [path]')
  .description('One-time migration: notes/NN_*.md -> notes/active/NN_*.md')
  .action(async (path: string | undefined) => {
    const root = path ? (await import('node:path')).resolve(path) : process.cwd();
    const { runMigrateNotes } = await import('./commands/migrate.js');
    await runMigrateNotes({ root });
  });

program
  .command('run')
  .description('Autonomous tick (topic repo), or workspace orchestration (super-repo with researcher.workspace.yml)')
  .action(async () => {
    const cwd = process.cwd();
    const { existsSync } = await import('node:fs');
    const { resolveProjectResearcherDir } = await import('./paths.js');
    const { hasWorkspaceManifest } = await import('./workspace/manifest.js');
    // A topic repo (.researcher/ present) always runs single-topic; only a
    // super-repo without its own .researcher/ enters workspace orchestration.
    if (!existsSync(resolveProjectResearcherDir(cwd)) && hasWorkspaceManifest(cwd)) {
      const { runWorkspace } = await import('./workspace/orchestrator.js');
      await runWorkspace({ cwd });
    } else {
      const { runRun } = await import('./commands/run.js');
      await runRun({ cwd });
    }
  });

program
  .command('serve [path]')
  .description('Start a local web console over a workspace super-repo (researcher.workspace.yml)')
  .option('-p, --port <port>', 'port to listen on', '4500')
  .action(async (path: string | undefined, opts: { port: string }) => {
    const root = path ? (await import('node:path')).resolve(path) : process.cwd();
    const { startServer } = await import('./web/server.js');
    const { port } = await startServer({ root, port: Number(opts.port) });
    process.stdout.write(`researcher web console → http://127.0.0.1:${port}  (root: ${root})\n`);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
