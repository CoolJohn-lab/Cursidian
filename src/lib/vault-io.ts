import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafePathAsync, assertContentSize, probePath } from './security.js';
import { logger } from './logger.js';

const pathLocks = new Map<string, Promise<void>>();

let inFlight = 0;
const idleWaiters: Array<() => void> = [];

export function beginInFlight(): void {
  inFlight++;
}

export function endInFlight(): void {
  inFlight = Math.max(0, inFlight - 1);
  if (inFlight === 0) {
    while (idleWaiters.length) {
      idleWaiters.shift()!();
    }
  }
}

/**
 * Resolves true when no locked mutations remain, or false if timeout elapses first.
 */
export function drainInFlight(timeoutMs: number): Promise<boolean> {
  if (inFlight === 0) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    idleWaiters.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Exposed for tests. */
export function getInFlightCount(): number {
  return inFlight;
}

function resolveLockPath(absolutePath: string): string {
  return path.resolve(absolutePath);
}

function dedupeAndSortLockPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of paths) {
    const resolved = resolveLockPath(p);
    const key = resolved.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(resolved);
    }
  }
  unique.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return unique;
}

/**
 * Serializes operations on a single absolute path within one process.
 */
export async function withPathLock<T>(absolutePath: string, fn: () => Promise<T>): Promise<T> {
  const normalized = resolveLockPath(absolutePath);
  const prior = pathLocks.get(normalized) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.then(() => gate);
  pathLocks.set(normalized, queued);
  await prior;
  beginInFlight();
  try {
    return await fn();
  } finally {
    endInFlight();
    release();
    if (pathLocks.get(normalized) === queued) {
      pathLocks.delete(normalized);
    }
  }
}

/**
 * Acquires nested locks on multiple paths in deterministic case-insensitive order.
 */
export async function withPathLocks<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = dedupeAndSortLockPaths(paths);
  if (sorted.length === 0) {
    return fn();
  }
  if (sorted.length === 1) {
    return withPathLock(sorted[0], fn);
  }
  return withPathLock(sorted[0], () => withPathLocks(sorted.slice(1), fn));
}

/**
 * Clears in-process path locks (tests).
 */
export function clearPathLocks(): void {
  pathLocks.clear();
}

/**
 * Returns the number of active path lock entries (tests).
 */
export function getPathLockCount(): number {
  return pathLocks.size;
}

const TMP_REAP_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Removes orphaned `.cursidian-*.tmp` files older than a few minutes (best-effort).
 */
export async function reapOrphanTempFiles(vaultPath: string): Promise<number> {
  let removed = 0;
  const cutoff = Date.now() - TMP_REAP_MAX_AGE_MS;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        await walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.startsWith('.cursidian-') || !entry.name.endsWith('.tmp')) {
        continue;
      }
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs <= cutoff) {
          await fs.rm(full, { force: true });
          removed++;
        }
      } catch {
        // best-effort
      }
    }
  }

  try {
    await walk(vaultPath);
  } catch (err) {
    logger.warn('orphan temp reap failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return removed;
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
  readonly restored: string[];
  readonly unresolved: string[];
  /** @deprecated use unresolved */
  readonly failed: string[];

  constructor(message: string, completed: string[], restored: string[], unresolved: string[]) {
    super(message);
    this.name = 'PartialUpdateError';
    this.completed = completed;
    this.restored = restored;
    this.unresolved = unresolved;
    this.failed = unresolved;
  }
}

async function revalidateWritable(vaultPath: string, targetPath: string): Promise<void> {
  await assertSafePathAsync(vaultPath, targetPath);
}

/**
 * Creates a new file exclusively (caller must already hold the path lock).
 */
export async function createExclusiveLocked(
  vaultPath: string,
  targetPath: string,
  body: string,
  maxBytes: number,
): Promise<void> {
  assertContentSize(body, maxBytes);
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
}

/**
 * Atomically replaces file contents (caller must already hold the path lock).
 */
export async function atomicReplaceLocked(
  vaultPath: string,
  targetPath: string,
  body: string,
  maxBytes: number,
): Promise<void> {
  assertContentSize(body, maxBytes);
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
}

/**
 * Creates or overwrites a file atomically (caller must already hold the path lock).
 */
export async function atomicWriteLocked(
  vaultPath: string,
  targetPath: string,
  body: string,
  maxBytes: number,
  options?: { exclusive?: boolean },
): Promise<void> {
  if (options?.exclusive) {
    await createExclusiveLocked(vaultPath, targetPath, body, maxBytes);
    return;
  }

  const probe = await probePath(targetPath);
  if (probe.kind === 'inaccessible') {
    throw probe.cause instanceof Error
      ? probe.cause
      : new Error(`Path inaccessible: ${targetPath}`);
  }
  const exists = probe.kind === 'exists';

  if (!exists) {
    try {
      await createExclusiveLocked(vaultPath, targetPath, body, maxBytes);
      return;
    } catch (err) {
      if (!(err instanceof AlreadyExistsError)) {
        throw err;
      }
    }
  }

  await atomicReplaceLocked(vaultPath, targetPath, body, maxBytes);
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
  await withPathLock(targetPath, async () => {
    await createExclusiveLocked(vaultPath, targetPath, body, maxBytes);
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
  await withPathLock(targetPath, async () => {
    await atomicReplaceLocked(vaultPath, targetPath, body, maxBytes);
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
  await withPathLock(targetPath, async () => {
    await atomicWriteLocked(vaultPath, targetPath, body, maxBytes, options);
  });
}
