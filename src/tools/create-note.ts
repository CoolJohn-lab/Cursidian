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
import { backupNoteIfExists } from '../lib/backup.js';
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

      if (!doOverwrite) {
        try {
          await atomicWrite(config.vaultPath, resolved, body, config.maxFileSize, {
            exclusive: true,
          });
        } catch (e) {
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
      } else {
        const result = await withPathLock(resolved, async () => {
          let exists = false;
          try {
            await fs.access(resolved);
            exists = true;
          } catch {
            exists = false;
          }

          let warnings: string[] | undefined;
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
            warnings = revisionCheck.warnings;

            if (config.backupEnabled) {
              await backupNoteIfExists(config.vaultPath, resolved);
            }
          }

          await atomicWriteLocked(config.vaultPath, resolved, body, config.maxFileSize);

          const relative = toRelativePath(config.vaultPath, resolved);
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
          });
        });

        if (result.isError) {
          return result;
        }

        clearAllSearchCaches();
        logger.info('Note created', { path: notePath, overwrite: true });
        return result;
      }

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Note created', { path: relative, overwrite: false });

      return ok(
        { created: relative, overwrite: false, revisionHash: computeRevisionHash(body) },
        { action: 'create', changed: true, paths: [relative] },
      );
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
