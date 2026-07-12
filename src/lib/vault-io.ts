import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafePathAsync } from './security.js';
import { assertContentSize } from './security.js';

const pathLocks = new Map<string, Promise<void>>();

/**
 * Serializes operations on a single absolute path within one process.
 */
export async function withPathLock<T>(absolutePath: string, fn: () => Promise<T>): Promise<T> {
  const normalized = path.resolve(absolutePath);
  const prior = pathLocks.get(normalized) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  pathLocks.set(normalized, prior.then(() => gate));
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (pathLocks.get(normalized) === gate) {
      pathLocks.delete(normalized);
    }
  }
}

/**
 * Clears in-process path locks (tests).
 */
export function clearPathLocks(): void {
  pathLocks.clear();
}

export class AlreadyExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyExistsError';
  }
}

export class PartialUpdateError extends Error {
  readonly code = 'partial_update';
  readonly completed: string[];
  readonly failed: string[];

  constructor(message: string, completed: string[], failed: string[]) {
    super(message);
    this.name = 'PartialUpdateError';
    this.completed = completed;
    this.failed = failed;
  }
}

async function revalidateWritable(vaultPath: string, targetPath: string): Promise<void> {
  await assertSafePathAsync(vaultPath, targetPath);
}

/**
 * Creates a new file exclusively (fails if it already exists).
 */
export async function createExclusive(
  vaultPath: string,
  targetPath: string,
  body: string,
  maxBytes: number,
): Promise<void> {
  assertContentSize(body, maxBytes);
  await withPathLock(targetPath, async () => {
    await revalidateWritable(vaultPath, targetPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await revalidateWritable(vaultPath, targetPath);
    try {
      const handle = await fs.open(targetPath, 'wx');
      try {
        await handle.writeFile(body, 'utf-8');
      } finally {
        await handle.close();
      }
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'EEXIST'
      ) {
        throw new AlreadyExistsError(`File already exists: ${targetPath}`);
      }
      throw err;
    }
  });
}

/**
 * Atomically replaces file contents via same-directory temp + rename.
 */
export async function atomicReplace(
  vaultPath: string,
  targetPath: string,
  body: string,
  maxBytes: number,
): Promise<void> {
  assertContentSize(body, maxBytes);
  await withPathLock(targetPath, async () => {
    await revalidateWritable(vaultPath, targetPath);
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    const tempName = `.cursidian-${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`;
    const tempPath = path.join(dir, tempName);
    try {
      await fs.writeFile(tempPath, body, 'utf-8');
      await revalidateWritable(vaultPath, targetPath);
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw err;
    }
  });
}

/**
 * Creates or overwrites a file atomically.
 */
export async function atomicWrite(
  vaultPath: string,
  targetPath: string,
  body: string,
  maxBytes: number,
  options?: { exclusive?: boolean },
): Promise<void> {
  if (options?.exclusive) {
    await createExclusive(vaultPath, targetPath, body, maxBytes);
    return;
  }

  let exists = false;
  try {
    await fs.access(targetPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    try {
      await createExclusive(vaultPath, targetPath, body, maxBytes);
      return;
    } catch (err) {
      if (!(err instanceof AlreadyExistsError)) {
        throw err;
      }
    }
  }

  await atomicReplace(vaultPath, targetPath, body, maxBytes);
}
