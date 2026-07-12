import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, assertContentSize } from '../lib/security.js';
import { stringifyFrontmatter } from '../lib/frontmatter.js';
import { withCreateTimestamps } from '../lib/timestamps.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { atomicWrite, AlreadyExistsError } from '../lib/vault-io.js';
import { backupNoteIfExists } from '../lib/backup.js';
import { MAX_CONTENT_BYTES } from '../lib/limits.js';
import { logger } from '../lib/logger.js';
import { ok, err, mapToolError } from '../types/index.js';

export function createNoteHandler(config: Config) {
  return async ({
    path: notePath,
    content,
    frontmatter,
    overwrite,
  }: {
    path: string;
    content: string;
    frontmatter?: Record<string, unknown>;
    overwrite?: boolean;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);
      assertContentSize(content, Math.min(config.maxFileSize, MAX_CONTENT_BYTES));

      const resolved = resolvePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      const doOverwrite = overwrite ?? false;
      const fm = frontmatter ? withCreateTimestamps(frontmatter as Record<string, unknown>) : undefined;
      const body = fm ? stringifyFrontmatter(fm, content) : content;

      if (doOverwrite && config.backupEnabled) {
        await backupNoteIfExists(config.vaultPath, resolved);
      }

      try {
        await atomicWrite(config.vaultPath, resolved, body, config.maxFileSize, {
          exclusive: !doOverwrite,
        });
      } catch (e) {
        if (e instanceof AlreadyExistsError) {
          return err(
            `Note already exists: "${notePath}". Use overwrite: true to replace it, or choose a different path.`,
            'already_exists',
            {
              path: notePath,
              hint: 'Pass overwrite: true to replace, or choose a different path.',
            },
          );
        }
        throw e;
      }

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Note created', { path: relative, overwrite: doOverwrite });

      return ok({ created: relative, overwrite: doOverwrite });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
