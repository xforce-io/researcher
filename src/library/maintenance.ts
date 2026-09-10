import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';

export const MAINTENANCE_DIR = '.researcher-workspace/maintenance';

export type MaintenanceStage =
  | 'maintenance'
  | 'converting'
  | 'activating'
  | 'references-pending'
  | 'completed';

export interface WriterProcess {
  pid: number;
  command: string;
  cwd?: string;
}

export interface UsageLease {
  pid: number;
  mode: 'shared' | 'exclusive';
  command: string;
  startedAt: string;
}

interface StageFile {
  stage: MaintenanceStage;
}

const RESEARCHER_WRITER_RE =
  /(?:\bresearcher(?:\.js)?|\bcli\.js)(?:\s+\S+)*\s+(?:serve|run\b|read\b|library (?:import|add)|migrate-notes|workspace sync)\b/;
const MIGRATE_RE = /(?:\bresearcher(?:\.js)?|\bcli\.js)(?:\s+\S+)*\s+library migrate\b/;

export function maintenanceDir(workspaceRoot: string): string {
  return join(workspaceRoot, MAINTENANCE_DIR);
}

export function readMaintenanceStage(workspaceRoot: string): MaintenanceStage | undefined {
  const path = join(maintenanceDir(workspaceRoot), 'stage.json');
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as StageFile;
    return raw.stage;
  } catch {
    return undefined;
  }
}

export function writeMaintenanceStage(workspaceRoot: string, stage: MaintenanceStage): void {
  const dir = maintenanceDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stage.json'), `${JSON.stringify({ stage }, null, 2)}\n`);
}

export function maintenanceStage(workspaceRoot: string): MaintenanceStage | undefined {
  return readMaintenanceStage(workspaceRoot);
}

export function listUsageLeases(workspaceRoot: string): UsageLease[] {
  const path = join(maintenanceDir(workspaceRoot), 'usage.json');
  if (!existsSync(path)) return [];
  try {
    const rows = JSON.parse(readFileSync(path, 'utf8')) as UsageLease[];
    return rows.filter((row) => processAlive(row.pid));
  } catch {
    return [];
  }
}

export function addUsageLease(workspaceRoot: string, lease: UsageLease): void {
  const dir = maintenanceDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const live = listUsageLeases(workspaceRoot).filter((l) => l.pid !== lease.pid);
  live.push(lease);
  writeFileSync(join(dir, 'usage.json'), `${JSON.stringify(live, null, 2)}\n`);
}

export function removeUsageLease(workspaceRoot: string, pid: number): void {
  const dir = maintenanceDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const live = listUsageLeases(workspaceRoot).filter((l) => l.pid !== pid);
  writeFileSync(join(dir, 'usage.json'), `${JSON.stringify(live, null, 2)}\n`);
}

export function acquireSharedLease(workspaceRoot: string, command: string): () => void {
  const stage = readMaintenanceStage(workspaceRoot);
  if (stage && stage !== 'completed') {
    throw new Error(`library maintenance in progress (${stage})`);
  }
  if (listUsageLeases(workspaceRoot).some((l) => l.mode === 'exclusive')) {
    throw new Error('library exclusive lease held');
  }
  addUsageLease(workspaceRoot, {
    pid: process.pid,
    mode: 'shared',
    command,
    startedAt: new Date().toISOString(),
  });
  return () => removeUsageLease(workspaceRoot, process.pid);
}

export function tryAcquireExclusiveLease(workspaceRoot: string, command: string): string | undefined {
  const holders = listUsageLeases(workspaceRoot).filter((l) => l.pid !== process.pid);
  if (holders.length > 0) {
    return holders.map((h) => `pid=${h.pid} command=${h.command}`).join('; ');
  }
  addUsageLease(workspaceRoot, {
    pid: process.pid,
    mode: 'exclusive',
    command,
    startedAt: new Date().toISOString(),
  });
  return undefined;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function cwdIsWorkspace(cwd: string, workspaceRoot: string): boolean {
  const a = resolvePath(cwd);
  const b = resolvePath(workspaceRoot);
  return a === b || a.startsWith(`${b}/`);
}

function processCwd(pid: number): string | undefined {
  try {
    const { stdout } = execaSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 });
    const line = stdout.split('\n').find((l) => l.startsWith('n'));
    return line?.slice(1);
  } catch {
    return undefined;
  }
}

export function ancestorPids(pid: number): number[] {
  const seen = new Set<number>();
  let current = pid;
  while (current > 1 && !seen.has(current)) {
    seen.add(current);
    try {
      const { stdout } = execaSync('ps', ['-p', String(current), '-o', 'ppid='], { timeout: 2000 });
      const ppid = Number(stdout.trim());
      if (!Number.isFinite(ppid) || ppid <= 1) break;
      current = ppid;
    } catch {
      break;
    }
  }
  return [...seen];
}

export function listResearcherWriters(opts: {
  workspaceRoot: string;
  migratePid?: number;
}): WriterProcess[] {
  let stdout = '';
  try {
    stdout = execaSync('ps', ['-ax', '-o', 'pid=,command='], { timeout: 5000 }).stdout;
  } catch {
    throw new Error('unable to read researcher process table');
  }
  const excluded = new Set(ancestorPids(opts.migratePid ?? process.pid));
  const writers: WriterProcess[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^(\d+)\s+(.*)$/.exec(trimmed);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = m[2];
    if (excluded.has(pid)) continue;
    if (MIGRATE_RE.test(command)) continue;
    if (!RESEARCHER_WRITER_RE.test(command)) continue;
    const cwd = processCwd(pid);
    if (cwd && !cwdIsWorkspace(cwd, opts.workspaceRoot)) continue;
    writers.push({ pid, command, cwd });
  }
  return writers;
}

export function listRegisteredSchedulers(_workspaceRoot: string): string[] {
  return [];
}
