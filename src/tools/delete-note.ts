import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly } from '../lib/security.js';
import { backupNote } from '../lib/backup.js';
import { clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { logger } from '../lib/logger.js';
import { ok, mapToolError } from '../types/index.js';

export function deleteNoteHandler(config: Config) {
  return async ({ path: notePath, confirm: _confirm }: { path: string; confirm: true }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      let backupPath: string | undefined;
      if (config.backupEnabled) {
        backupPath = await backupNote(config.vaultPath, resolved);
      }

      await fs.unlink(resolved);

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Note deleted', { path: relative, backup: backupPath });

      return ok({
        deleted: relative,
        backup: backupPath
          ? `Backup saved to: ${backupPath}`
          : 'Backup disabled - note permanently removed.',
      });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
