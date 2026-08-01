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

const library = program.command('library').description('Manage the workspace paper library');
library
  .command('add <input>')
  .description('Add or update a paper/document in the workspace library')
  .option('--tags <tags>', 'comma-separated paper-level tags')
  .option('--type <docType>', 'paper | design-doc | spec | blog | api-doc | other')
  .action(async (input: string, opts: { tags?: string; type?: string }) => {
    const { parseTags, runLibraryAdd } = await import('./commands/library.js');
    const { parseDocType } = await import('./library/doc-type.js');
    runLibraryAdd({
      input,
      cwd: process.cwd(),
      tags: opts.tags === undefined ? undefined : parseTags(opts.tags),
      docType: opts.type === undefined ? undefined : parseDocType(opts.type),
    });
  });
library
  .command('list')
  .description('List workspace library papers')
  .action(async () => {
    const { runLibraryList } = await import('./commands/library.js');
    runLibraryList({ cwd: process.cwd() });
  });
library
  .command('link <paper-id>')
  .description('Link a library paper to a topic surface')
  .requiredOption('--topic <topic>', 'topic id/path')
  .option('--relation <relation>', 'candidate, relevant, integrated, rejected, or archived', 'candidate')
  .option('--rationale <text>', 'short reason for the relation')
  .action(async (paperId: string, opts: { topic: string; relation: string; rationale?: string }) => {
    const { parseRelation, runLibraryLink } = await import('./commands/library.js');
    runLibraryLink({ paperId, cwd: process.cwd(), topic: opts.topic, relation: parseRelation(opts.relation), rationale: opts.rationale });
  });
library
  .command('integrate <paper-id>')
  .description('Record that a library paper has been integrated into a topic')
  .requiredOption('--topic <topic>', 'topic id/path')
  .option('--note <path>', 'integrated note path')
  .option('--zone <zone>', 'active, buffer, or history')
  .option('--summary <text>', 'short integration summary')
  .action(async (paperId: string, opts: { topic: string; note?: string; zone?: string; summary?: string }) => {
    const { runLibraryIntegrate } = await import('./commands/library.js');
    const zone = parseZone(opts.zone);
    runLibraryIntegrate({ paperId, cwd: process.cwd(), topic: opts.topic, notePath: opts.note, zone, summary: opts.summary });
  });
library
  .command('delete <paper-id>')
  .description('Delete an unlinked Library paper (refuses if linked/integrated to any topic)')
  .action(async (paperId: string) => {
    const { runLibraryDelete } = await import('./commands/library.js');
    runLibraryDelete({ paperId, cwd: process.cwd() });
  });

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

const workspace = program.command('workspace').description('Workspace super-repo git alignment');
workspace
  .command('sync')
  .description('Pull / push topics / bump submodule pointers (explicit; orthogonal to delivery.mode)')
  .option('--pull', 'fetch + ff-only current branch on topics with origin')
  .option('--push-topics', 'push current branch to origin')
  .option('--pointers', 'commit submodule gitlink bumps in the super-repo')
  .option('--all', 'include dormant topics')
  .option('--dry-run', 'report only; no push/commit/gitmodules writes')
  .option('--cwd <path>', 'workspace root (default: cwd)')
  .action(async (opts: {
    pull?: boolean;
    pushTopics?: boolean;
    pointers?: boolean;
    all?: boolean;
    dryRun?: boolean;
    cwd?: string;
  }) => {
    const { runWorkspaceSyncCli } = await import('./commands/workspace.js');
    await runWorkspaceSyncCli({
      cwd: opts.cwd,
      pull: opts.pull,
      pushTopics: opts.pushTopics,
      pointers: opts.pointers,
      all: opts.all,
      dryRun: opts.dryRun,
    });
  });
workspace
  .command('publish <path>')
  .description('Promote a local topic pillar to a submodule with origin')
  .requiredOption('--remote <url>', 'origin git URL (repo must already exist)')
  .option('--dry-run', 'report only')
  .option('--cwd <path>', 'workspace root (default: cwd)')
  .action(async (path: string, opts: { remote: string; dryRun?: boolean; cwd?: string }) => {
    const { runWorkspacePublishCli } = await import('./commands/workspace.js');
    await runWorkspacePublishCli(path, {
      cwd: opts.cwd,
      remote: opts.remote,
      dryRun: opts.dryRun,
    });
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
      await runRun({ cwd, workspaceRoot: process.env.RESEARCHER_WORKSPACE_ROOT });
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

function parseZone(raw: string | undefined): 'active' | 'buffer' | 'history' | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'active' || raw === 'buffer' || raw === 'history') return raw;
  throw new Error(`invalid zone: ${raw}. expected one of active, buffer, history`);
}
