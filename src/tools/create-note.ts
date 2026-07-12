import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, assertContentSize, readFileBounded } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { checkRevisionConcurrency, computeRevisionHash } from '../lib/content-hash.js';
import { withCreateTimestamps } from '../lib/timestamps.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import {
  withPathLock,
  atomicWrite,
  atomicWriteLocked,
  AlreadyExistsError,
} from '../lib/vault-io.js';
import { OperationJournal, mergeOperationWarnings } from '../lib/operation-journal.js';
import { MAX_CONTENT_BYTES } from '../lib/limits.js';
import { logger } from '../lib/logger.js';
import { ok, err, toolError, mapToolError } from '../types/index.js';

export function createNoteHandler(config: Config) {
  return async ({
    path: notePath,
    content,
    frontmatter,
    overwrite,
    expectedRevision,
    expectedHash,
  }: {
    path: string;
    content: string;
    frontmatter?: Record<string, unknown>;
    overwrite?: boolean;
    expectedRevision?: string;
    expectedHash?: string;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);
      assertContentSize(content, Math.min(config.maxFileSize, MAX_CONTENT_BYTES));

      const resolved = resolvePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      const doOverwrite = overwrite ?? false;
      const fm = frontmatter ? withCreateTimestamps(frontmatter as Record<string, unknown>) : undefined;
      const body = fm ? stringifyFrontmatter(fm, content) : content;
      const relative = toRelativePath(config.vaultPath, resolved);

      if (!doOverwrite) {
        const journal = await OperationJournal.begin(config.vaultPath, {
          backupEnabled: config.backupEnabled,
          tool: 'note',
          action: 'create',
        });

        try {
          journal.recordNewFile(relative);
          await atomicWrite(config.vaultPath, resolved, body, config.maxFileSize, {
            exclusive: true,
          });
          await journal.recordAfter(relative, computeRevisionHash(body));
          const op = await journal.finalize();

          clearAllSearchCaches();
          logger.info('Note created', { path: relative, overwrite: false });

          const warnings = mergeOperationWarnings(undefined, op);

          return ok(
            {
              created: relative,
              overwrite: false,
              revisionHash: computeRevisionHash(body),
              ...(warnings ? { warnings } : {}),
            },
            {
              action: 'create',
              changed: true,
              paths: [relative],
              warnings,
              operationId: op.operationId,
              undoAvailable: op.undoAvailable,
            },
          );
        } catch (e) {
          await journal.abort();
          if (e instanceof AlreadyExistsError) {
            return err(
              `Note already exists: "${notePath}". Use overwrite: true to replace it, or choose a different path.`,
              'already_exists',
              {
                action: 'create',
                retryable: true,
                sideEffects: 'none',
                path: notePath,
                details: { existingPath: notePath },
                recovery: {
                  tool: 'note',
                  arguments: { action: 'read', path: notePath },
                },
                hint: 'Read the existing note before deciding whether to overwrite it.',
              },
            );
          }
          throw e;
        }
      }

      const result = await withPathLock(resolved, async () => {
        const journal = await OperationJournal.begin(config.vaultPath, {
          backupEnabled: config.backupEnabled,
          tool: 'note',
          action: 'create',
        });

        try {
          let exists = false;
          try {
            await fs.access(resolved);
            exists = true;
          } catch {
            exists = false;
          }

          let revisionWarnings: string[] | undefined;
          if (exists) {
            const raw = await readFileBounded(resolved, config.maxFileSize);
            const { content: existingBody } = parseFrontmatter(raw);
            const revisionCheck = checkRevisionConcurrency({
              raw,
              body: existingBody,
              expectedRevision,
              expectedHash,
            });
            if (!revisionCheck.ok) {
              await journal.abort();
              return toolError({
                error: 'hash_mismatch',
                message: revisionCheck.message,
                action: 'create',
                retryable: true,
                sideEffects: 'none',
                path: notePath,
                details: { check: expectedRevision ? 'revision' : 'content_hash' },
                recovery: {
                  tool: 'note',
                  arguments: { action: 'read', path: notePath },
                },
                hint: revisionCheck.hint,
              });
            }
            revisionWarnings = revisionCheck.warnings;
          }

          await journal.recordBefore(resolved, config.maxFileSize);
          await atomicWriteLocked(config.vaultPath, resolved, body, config.maxFileSize);
          await journal.recordAfter(relative, computeRevisionHash(body));
          const op = await journal.finalize();

          const warnings = mergeOperationWarnings(revisionWarnings, op);

          return ok({
            created: relative,
            overwrite: true,
            revisionHash: computeRevisionHash(body),
            ...(warnings ? { warnings } : {}),
          }, {
            action: 'create',
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

      if (result.isError) {
        return result;
      }

      clearAllSearchCaches();
      logger.info('Note created', { path: notePath, overwrite: true });
      return result;
    } catch (e) {
      return mapToolError(e, {
        tool: 'note',
        action: 'create',
        path: notePath,
        arguments: { action: 'create', path: notePath, content, overwrite },
      });
    }
  };
}
