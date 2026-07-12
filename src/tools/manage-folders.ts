import fs from 'node:fs/promises';
import fg from 'fast-glob';
import { type Config } from '../config.js';
import { resolveDir } from '../lib/vault.js';
import { assertSafePath, assertNotReadOnly } from '../lib/security.js';
import { logger } from '../lib/logger.js';
import { ok, err, mapToolError } from '../types/index.js';

/** Join vault-relative folder segments with `/` (never OS backslashes). */
function joinVaultFolder(...parts: string[]): string {
  return parts
    .flatMap((p) => p.replace(/\\/g, '/').split('/'))
    .filter((p) => p.length > 0)
    .join('/');
}

export function manageFoldersHandler(config: Config) {
  return async ({
    operation,
    path: folderPath,
    confirm,
  }: {
    operation: 'create' | 'list' | 'delete';
    path: string;
    confirm?: boolean;
  }) => {
    try {
      if (operation !== 'list') {
        assertNotReadOnly(config.readOnly);
      }

      const resolved = resolveDir(config.vaultPath, folderPath);
      assertSafePath(config.vaultPath, resolved);

      if (operation === 'create') {
        await fs.mkdir(resolved, { recursive: true });
        logger.info('Folder created', { path: folderPath });
        return ok({ created: folderPath });
      }

      if (operation === 'list') {
        const entries = await fg('*', {
          cwd: resolved,
          onlyDirectories: true,
          dot: false,
        });
        const subfolders = entries.map((e) => joinVaultFolder(folderPath, e));
        return ok({ folder: folderPath.replace(/\\/g, '/'), subfolders });
      }

      if (!confirm) {
        return err('Folder deletion requires confirm: true. This operation cannot be undone.');
      }

      const contents = await fs.readdir(resolved);
      if (contents.length > 0) {
        return err(
          `Folder "${folderPath}" is not empty (${contents.length} items). Remove all contents first before deleting the folder.`,
        );
      }

      await fs.rmdir(resolved);
      logger.info('Folder deleted', { path: folderPath });
      return ok({ deleted: folderPath });
    } catch (e) {
      return mapToolError(e, { path: folderPath });
    }
  };
}
