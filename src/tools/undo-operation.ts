import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { assertNotReadOnly, pathExistsOrThrow } from '../lib/security.js';
import { computeRevisionHash } from '../lib/content-hash.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { withPathLocks, atomicReplaceLocked } from '../lib/vault-io.js';
import {
  OperationJournal,
  collectUndoConflicts,
  readOperationManifest,
  snapshotAbsolutePath,
  mergeOperationWarnings,
} from '../lib/operation-journal.js';
import { ok, toolError, mapToolError } from '../types/index.js';
import { logger } from '../lib/logger.js';

export function undoOperationHandler(config: Config) {
  return async ({ operationId, force }: { operationId: string; force?: boolean }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const manifest = await readOperationManifest(config.vaultPath, operationId);
      if (!manifest) {
        return toolError({
          error: 'not_found',
          message: `Operation journal not found: ${operationId}`,
          action: 'undo',
          retryable: false,
          sideEffects: 'none',
          details: { operationId },
          recovery: { tool: 'vault', arguments: { action: 'history' } },
          hint: 'List recent operations with vault action history.',
        });
      }

      if (!manifest.complete) {
        return toolError({
          error: 'undo_unavailable',
          message: `Operation journal is incomplete: ${operationId}`,
          action: 'undo',
          retryable: false,
          sideEffects: 'none',
          details: { operationId, complete: false },
          recovery: { tool: 'vault', arguments: { action: 'history' } },
          hint: 'This operation was interrupted before journaling finished.',
        });
      }

      if (!manifest.undoAvailable) {
        return toolError({
          error: 'undo_unavailable',
          message: `Undo is not available for operation: ${operationId}`,
          action: 'undo',
          retryable: false,
          sideEffects: 'none',
          details: { operationId, undoAvailable: false },
          recovery: { tool: 'vault', arguments: { action: 'history' } },
          hint: 'The operation was performed with OBSIDIAN_BACKUP_ENABLED=false.',
        });
      }

      const conflicts = await collectUndoConflicts(config.vaultPath, manifest, config.maxFileSize);
      if (conflicts.length > 0 && !force) {
        return toolError({
          error: 'undo_conflict',
          message: 'One or more files changed since the operation; undo refused.',
          action: 'undo',
          retryable: true,
          sideEffects: 'none',
          details: { conflicts, operationId },
          recovery: {
            tool: 'vault',
            arguments: { action: 'undo', operationId, confirm: true, force: true },
          },
          hint: 'Re-read affected notes or pass force: true to override.',
        });
      }

      const journal = await OperationJournal.begin(config.vaultPath, {
        backupEnabled: config.backupEnabled,
        tool: 'vault',
        action: 'undo',
      });

      const restored: string[] = [];
      const removed: string[] = [];

      try {
        const lockPaths = manifest.entries.map((entry) => path.join(config.vaultPath, entry.path));

        await withPathLocks(lockPaths.length > 0 ? lockPaths : [config.vaultPath], async () => {
          for (const entry of manifest.entries) {
            const absolute = path.join(config.vaultPath, entry.path);
            await journal.recordBefore(absolute, config.maxFileSize);

            if (entry.existedBefore) {
              if (!entry.snapshotFile) {
                throw new Error(`Missing snapshot for ${entry.path}`);
              }
              const snapshot = snapshotAbsolutePath(
                config.vaultPath,
                operationId,
                entry.snapshotFile,
              );
              const snapshotContent = await fs.readFile(snapshot, 'utf-8');
              await fs.mkdir(path.dirname(absolute), { recursive: true });
              await atomicReplaceLocked(
                config.vaultPath,
                absolute,
                snapshotContent,
                config.maxFileSize,
              );
              restored.push(entry.path);
              const revision = computeRevisionHash(snapshotContent);
              await journal.recordAfter(entry.path, revision);
            } else if (await pathExistsOrThrow(absolute)) {
              await fs.unlink(absolute);
              removed.push(entry.path);
              await journal.recordAfter(entry.path, null);
            } else {
              removed.push(entry.path);
              await journal.recordAfter(entry.path, null);
            }
          }
        });

        const op = await journal.finalize();
        clearAllSearchCaches();
        logger.info('Operation undone', { operationId, restored, removed });

        return ok(
          {
            undone: operationId,
            restored,
            removed,
            ...(force ? { forced: true } : {}),
          },
          {
            action: 'undo',
            changed: restored.length + removed.length > 0,
            paths: [...restored, ...removed],
            operationId: op.operationId,
            undoAvailable: op.undoAvailable,
            warnings: mergeOperationWarnings(undefined, op),
          },
        );
      } catch (e) {
        await journal.abort();
        throw e;
      }
    } catch (e) {
      return mapToolError(e, {
        tool: 'vault',
        action: 'undo',
        arguments: { action: 'undo', operationId, confirm: true, force },
      });
    }
  };
}
