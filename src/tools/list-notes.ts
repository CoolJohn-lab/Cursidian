import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { type Config } from '../config.js';
import { resolveDir, toRelativePath } from '../lib/vault.js';
import { assertSafePath } from '../lib/security.js';
import { TRASH_GLOB_IGNORE } from '../lib/trash.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { ok, err, mapToolError, type NoteMetadata } from '../types/index.js';

export function listNotesHandler(config: Config) {
  return async ({
    folder,
    recursive,
    includeOperational,
  }: {
    folder?: string;
    recursive?: boolean;
    includeOperational?: boolean;
  }) => {
    try {
      const baseDir = folder ? resolveDir(config.vaultPath, folder) : config.vaultPath;
      const isRecursive = recursive ?? true;
      const effectiveIncludeOperational = includeOperational ?? false;

      if (folder) {
        assertSafePath(config.vaultPath, baseDir);
        try {
          const stat = await fs.stat(baseDir);
          if (!stat.isDirectory()) {
            return err(`Not a folder: "${folder}"`, 'not_found', { path: folder });
          }
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            return err(`Folder not found: "${folder}"`, 'not_found', { path: folder });
          }
          throw e;
        }
      }

      const pattern = isRecursive ? '**/*.md' : '*.md';
      const files = await fg(pattern, {
        cwd: baseDir,
        absolute: true,
        dot: false,
        ignore: [TRASH_GLOB_IGNORE],
      });

      const notes: NoteMetadata[] = [];
      for (const file of files) {
        const relativePath = toRelativePath(config.vaultPath, file);
        if (!effectiveIncludeOperational && isOperationalPath(relativePath)) {
          continue;
        }
        const stat = await fs.stat(file);
        notes.push({
          path: relativePath,
          name: path.basename(file, '.md'),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }

      notes.sort((a, b) => a.path.localeCompare(b.path));

      return ok({ count: notes.length, notes });
    } catch (e) {
      return mapToolError(e, { path: folder });
    }
  };
}
