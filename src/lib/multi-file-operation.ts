import fs from 'node:fs/promises';
import path from 'node:path';
import { toRelativePath } from './vault.js';
import { readFileBounded } from './security.js';
import { computeRevisionHash } from './content-hash.js';
import { atomicReplaceLocked, PartialUpdateError, withPathLocks } from './vault-io.js';
import { OperationJournal, mergeOperationWarnings } from './operation-journal.js';
import type { ToolName } from '../types/index.js';

export interface MultiFileOperationConfig {
  vaultPath: string;
  backupEnabled: boolean;
  maxFileSize: number;
}

export interface PathSnapshot {
  relative: string;
  absolute: string;
  existedBefore: boolean;
  content: string | null;
}

export type OperationStep =
  { type: 'write'; relative: string } | { type: 'rename'; from: string; to: string };

export class MultiFileOperationTracker {
  private readonly steps: OperationStep[] = [];

  recordWrite(relative: string): void {
    this.steps.push({ type: 'write', relative: relative.replace(/\\/g, '/') });
  }

  recordRename(from: string, to: string): void {
    this.steps.push({
      type: 'rename',
      from: from.replace(/\\/g, '/'),
      to: to.replace(/\\/g, '/'),
    });
  }

  getSteps(): OperationStep[] {
    return [...this.steps];
  }
}

export async function capturePathSnapshots(
  vaultPath: string,
  absolutePaths: string[],
  maxFileSize: number,
): Promise<PathSnapshot[]> {
  const snapshots: PathSnapshot[] = [];
  for (const absolute of absolutePaths) {
    const relative = toRelativePath(vaultPath, absolute).replace(/\\/g, '/');
    try {
      const content = await readFileBounded(absolute, maxFileSize);
      snapshots.push({ relative, absolute, existedBefore: true, content });
    } catch {
      snapshots.push({ relative, absolute, existedBefore: false, content: null });
    }
  }
  return snapshots;
}

async function restoreSnapshot(
  vaultPath: string,
  snapshot: PathSnapshot,
  maxFileSize: number,
): Promise<void> {
  if (snapshot.existedBefore) {
    if (snapshot.content === null) {
      throw new Error(`Missing snapshot content for ${snapshot.relative}`);
    }
    await fs.mkdir(path.dirname(snapshot.absolute), { recursive: true });
    await atomicReplaceLocked(vaultPath, snapshot.absolute, snapshot.content, maxFileSize);
    return;
  }

  try {
    await fs.unlink(snapshot.absolute);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    throw err;
  }
}

export async function rollbackOperationSteps(
  vaultPath: string,
  snapshots: PathSnapshot[],
  steps: OperationStep[],
  maxFileSize: number,
): Promise<{ restored: string[]; unresolved: string[] }> {
  const restored: string[] = [];
  const unresolved: string[] = [];
  const snapByRelative = new Map(snapshots.map((snap) => [snap.relative, snap]));

  for (const step of [...steps].reverse()) {
    if (step.type === 'write') {
      const snapshot = snapByRelative.get(step.relative);
      if (!snapshot) {
        unresolved.push(step.relative);
        continue;
      }
      try {
        await restoreSnapshot(vaultPath, snapshot, maxFileSize);
        restored.push(step.relative);
      } catch {
        unresolved.push(step.relative);
      }
      continue;
    }

    const fromAbs = path.join(vaultPath, step.from);
    const toAbs = path.join(vaultPath, step.to);
    try {
      await fs.rename(toAbs, fromAbs);
      restored.push(step.to);
      restored.push(step.from);
    } catch {
      const sourceSnap = snapByRelative.get(step.from);
      try {
        if (sourceSnap?.content) {
          await fs.mkdir(path.dirname(fromAbs), { recursive: true });
          await atomicReplaceLocked(vaultPath, fromAbs, sourceSnap.content, maxFileSize);
        }
        try {
          await fs.unlink(toAbs);
        } catch {
          // destination may already be gone
        }
        restored.push(step.from);
        if (sourceSnap?.content) {
          restored.push(step.to);
        }
      } catch {
        unresolved.push(step.from);
        unresolved.push(step.to);
      }
    }
  }

  return { restored, unresolved };
}

export function completedPathsFromSteps(steps: OperationStep[]): string[] {
  const completed: string[] = [];
  for (const step of steps) {
    if (step.type === 'write') {
      completed.push(step.relative);
    } else {
      completed.push(step.to);
    }
  }
  return completed;
}

export interface JournaledMultiFileResult<T> {
  value: T;
  operationId: string;
  undoAvailable: boolean;
  warnings: string[];
}

export async function runJournaledMultiFileOperation<T>(
  config: MultiFileOperationConfig,
  options: {
    tool: ToolName;
    action: string;
    lockPaths: string[];
    snapshotPaths: string[];
    run: (ctx: {
      journal: OperationJournal;
      tracker: MultiFileOperationTracker;
      recordAfter: (relative: string, revision: string | null) => Promise<void>;
      readRevision: (absolute: string) => Promise<string | null>;
    }) => Promise<T>;
  },
): Promise<JournaledMultiFileResult<T>> {
  const snapshots = await capturePathSnapshots(
    config.vaultPath,
    options.snapshotPaths,
    config.maxFileSize,
  );

  return withPathLocks(options.lockPaths, async () => {
    const journal = await OperationJournal.begin(config.vaultPath, {
      backupEnabled: config.backupEnabled,
      tool: options.tool,
      action: options.action,
    });
    const tracker = new MultiFileOperationTracker();

    for (const absolute of options.snapshotPaths) {
      await journal.recordBefore(absolute, config.maxFileSize);
    }

    const recordAfter = async (relative: string, revision: string | null) => {
      journal.recordAfter(relative.replace(/\\/g, '/'), revision);
    };

    const readRevision = async (absolute: string): Promise<string | null> => {
      try {
        const raw = await readFileBounded(absolute, config.maxFileSize);
        return computeRevisionHash(raw);
      } catch {
        return null;
      }
    };

    try {
      const value = await options.run({
        journal,
        tracker,
        recordAfter,
        readRevision,
      });
      const op = await journal.finalize();
      return {
        value,
        operationId: op.operationId,
        undoAvailable: op.undoAvailable,
        warnings: op.warnings,
      };
    } catch (error) {
      const steps = tracker.getSteps();
      const completed = completedPathsFromSteps(steps);
      const { restored, unresolved } = await rollbackOperationSteps(
        config.vaultPath,
        snapshots,
        steps,
        config.maxFileSize,
      );
      await journal.abort();

      if (unresolved.length > 0) {
        throw new PartialUpdateError(
          'Multi-file operation failed and rollback could not restore all paths.',
          completed,
          restored,
          unresolved,
        );
      }

      throw error;
    }
  });
}

export function mergeJournaledWarnings(
  existing: string[] | undefined,
  journaled: JournaledMultiFileResult<unknown>,
): string[] | undefined {
  return mergeOperationWarnings(existing, {
    operationId: journaled.operationId,
    undoAvailable: journaled.undoAvailable,
    warnings: journaled.warnings,
  });
}
