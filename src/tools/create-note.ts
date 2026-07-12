import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly } from '../lib/security.js';
import { stringifyFrontmatter } from '../lib/frontmatter.js';
import { withCreateTimestamps } from '../lib/timestamps.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
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

      const resolved = resolvePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      const doOverwrite = overwrite ?? false;

      try {
        await fs.access(resolved);
        if (!doOverwrite) {
          return err(
            `Note already exists: "${notePath}". Use overwrite: true to replace it, or choose a different path.`,
            'already_exists',
            {
              path: notePath,
              hint: 'Pass overwrite: true to replace, or choose a different path.',
            },
          );
        }
      } catch {
        // File doesn't exist - good, proceed
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });

      const fm = frontmatter ? withCreateTimestamps(frontmatter as Record<string, unknown>) : undefined;
      const body = fm ? stringifyFrontmatter(fm, content) : content;
      await fs.writeFile(resolved, body, 'utf-8');

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Note created', { path: relative, overwrite: doOverwrite });

      return ok({ created: relative, overwrite: doOverwrite });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
