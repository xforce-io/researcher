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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
