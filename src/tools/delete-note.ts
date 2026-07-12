import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, readFileBounded } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { checkRevisionConcurrency } from '../lib/content-hash.js';
import { clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { withPathLock } from '../lib/vault-io.js';
import { OperationJournal, mergeOperationWarnings } from '../lib/operation-journal.js';
import { logger } from '../lib/logger.js';
import { ok, toolError, mapToolError } from '../types/index.js';

export function deleteNoteHandler(config: Config) {
  return async ({
    path: notePath,
    confirm: _confirm,
    expectedRevision,
    expectedHash,
  }: {
    path: string;
    confirm: true;
    expectedRevision?: string;
    expectedHash?: string;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      return await withPathLock(resolved, async () => {
        const journal = await OperationJournal.begin(config.vaultPath, {
          backupEnabled: config.backupEnabled,
          tool: 'note',
          action: 'delete',
        });

        try {
          const raw = await readFileBounded(resolved, config.maxFileSize);
          const { content } = parseFrontmatter(raw);

          const revisionCheck = checkRevisionConcurrency({
            raw,
            body: content,
            expectedRevision,
            expectedHash,
          });
          if (!revisionCheck.ok) {
            await journal.abort();
            return toolError({
              error: 'hash_mismatch',
              message: revisionCheck.message,
              action: 'delete',
              retryable: true,
              sideEffects: 'none',
              path: notePath,
              details: { check: expectedRevision ? 'revision' : 'content_hash' },
              recovery: { tool: 'note', arguments: { action: 'read', path: notePath } },
              hint: revisionCheck.hint,
            });
          }

          await journal.recordBefore(resolved, config.maxFileSize);
          await fs.unlink(resolved);

          const relative = toRelativePath(config.vaultPath, resolved);
          await journal.recordAfter(relative, null);
          const op = await journal.finalize();

          clearAllSearchCaches();
          logger.info('Note deleted', { path: relative, operationId: op.operationId });

          const warnings = mergeOperationWarnings(revisionCheck.warnings, op);

          return ok({
            deleted: relative,
            ...(warnings ? { warnings } : {}),
          }, {
            action: 'delete',
            changed: true,
            paths: [relative],
            warnings,
            operationId: op.operationId,
            undoAvailable: op.undoAvailable,
          });
        } catch (e) {
          await journal.abort();
          throw e;
        }
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'note',
        action: 'delete',
        path: notePath,
        arguments: { action: 'read', path: notePath },
      });
    }
  };
}
