import { closeSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export async function withLock<T>(lockPath: string, body: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx'); // O_EXCL: fail if exists
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      throw new Error(
        `another researcher run is in progress (lock held at ${lockPath}). ` +
        `if no process is running, remove the file manually.`,
      );
    }
    throw err;
  }
  try {
    writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
  } finally {
    closeSync(fd);
  }
  try {
    return await body();
  } finally {
    rmSync(lockPath, { force: true });
  }
}
