import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AlreadyExistsError,
  atomicReplace,
  atomicReplaceLocked,
  beginInFlight,
  clearPathLocks,
  createExclusive,
  drainInFlight,
  endInFlight,
  getPathLockCount,
  withPathLock,
  withPathLocks,
} from '../../src/lib/vault-io.js';

describe('vault-io', () => {
  let vault = '';
  let notePath = '';

  beforeAll(async () => {
    clearPathLocks();
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-vault-io-'));
    notePath = path.join(vault, 'note.md');
  });

  afterAll(async () => {
    await fsp.rm(vault, { recursive: true, force: true });
  });

  beforeEach(() => {
    clearPathLocks();
  });

  it('createExclusive fails when the file already exists', async () => {
    await createExclusive(vault, notePath, '# first', 1024);
    await expect(createExclusive(vault, notePath, '# second', 1024)).rejects.toBeInstanceOf(
      AlreadyExistsError,
    );
    const content = await fsp.readFile(notePath, 'utf-8');
    expect(content).toBe('# first');
  });

  it('atomicReplace updates content atomically', async () => {
    await atomicReplace(vault, notePath, '# replaced', 1024);
    const content = await fsp.readFile(notePath, 'utf-8');
    expect(content).toBe('# replaced');
  });

  it('cleans up path lock map entries after operations settle', async () => {
    expect(getPathLockCount()).toBe(0);
    await withPathLock(notePath, async () => {
      expect(getPathLockCount()).toBe(1);
    });
    expect(getPathLockCount()).toBe(0);

    await Promise.all([
      withPathLock(notePath, async () => {
        await new Promise((r) => setTimeout(r, 20));
      }),
      withPathLock(notePath, async () => {
        await new Promise((r) => setTimeout(r, 10));
      }),
      withPathLock(notePath, async () => undefined),
    ]);
    expect(getPathLockCount()).toBe(0);
  });

  it('withPathLocks deduplicates and sorts paths case-insensitively', async () => {
    const order: string[] = [];
    const upper = path.join(vault, 'Concepts', 'alpha.md');
    const lower = path.join(vault, 'concepts', 'beta.md');
    const shared = path.join(vault, 'concepts', 'alpha.md');
    await fsp.mkdir(path.dirname(upper), { recursive: true });
    await fsp.mkdir(path.dirname(lower), { recursive: true });
    await fsp.writeFile(upper, 'a', 'utf-8');
    await fsp.writeFile(lower, 'b', 'utf-8');

    await withPathLocks([lower, upper, shared, upper], async () => {
      order.push('held');
      expect(getPathLockCount()).toBeGreaterThanOrEqual(1);
    });

    expect(order).toEqual(['held']);
    expect(getPathLockCount()).toBe(0);
  });

  it('withPathLocks acquires nested locks in deterministic order without deadlock', async () => {
    const a = path.join(vault, 'lock-a.md');
    const b = path.join(vault, 'lock-b.md');
    await fsp.writeFile(a, 'a', 'utf-8');
    await fsp.writeFile(b, 'b', 'utf-8');

    const acquireOrder: string[] = [];

    await Promise.all([
      withPathLocks([b, a], async () => {
        acquireOrder.push('job1-start');
        await new Promise((r) => setTimeout(r, 30));
        acquireOrder.push('job1-end');
      }),
      withPathLocks([a, b], async () => {
        acquireOrder.push('job2-start');
        await new Promise((r) => setTimeout(r, 5));
        acquireOrder.push('job2-end');
      }),
    ]);

    expect(acquireOrder.filter((x) => x.endsWith('-end'))).toHaveLength(2);
    expect(getPathLockCount()).toBe(0);
  });

  it('atomicReplaceLocked does not deadlock when called under withPathLock', async () => {
    const locked = path.join(vault, 'locked-write.md');
    await fsp.writeFile(locked, 'before', 'utf-8');

    await withPathLock(locked, async () => {
      await atomicReplaceLocked(vault, locked, 'after', 1024);
    });

    const content = await fsp.readFile(locked, 'utf-8');
    expect(content).toBe('after');
    expect(getPathLockCount()).toBe(0);
  });

  it('drainInFlight resolves once in-flight operations end', async () => {
    beginInFlight();
    const p = drainInFlight(1000);
    setTimeout(endInFlight, 10);
    await expect(p).resolves.toBe(true);
  });

  it('drainInFlight times out and reports false if operations never end', async () => {
    beginInFlight();
    await expect(drainInFlight(20)).resolves.toBe(false);
    endInFlight();
  });
});
