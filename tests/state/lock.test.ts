import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLock } from '../../src/state/lock.js';

describe('withLock', () => {
  it('runs the body, releases the lock, returns the body result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-lock-'));
    const lockPath = join(dir, '.lock');
    const result = await withLock(lockPath, async () => {
      expect(existsSync(lockPath)).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('releases the lock even when body throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-lock-'));
    const lockPath = join(dir, '.lock');
    await expect(withLock(lockPath, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('refuses to acquire a lock that is already held', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-lock-'));
    const lockPath = join(dir, '.lock');
    let inner: unknown;
    await withLock(lockPath, async () => {
      inner = await withLock(lockPath, async () => 'should-not-run').catch((e) => e);
    });
    expect(inner).toBeInstanceOf(Error);
    expect((inner as Error).message).toMatch(/lock|locked|already/i);
  });

  it('writes pid into the lock file (for diagnostics)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-lock-'));
    const lockPath = join(dir, '.lock');
    await withLock(lockPath, async () => {
      const body = readFileSync(lockPath, 'utf8');
      expect(body).toContain(String(process.pid));
    });
  });
});
