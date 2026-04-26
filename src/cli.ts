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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
