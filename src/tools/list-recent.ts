import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { type Config } from '../config.js';
import { resolveDir, toRelativePath } from '../lib/vault.js';
import { assertSafePath } from '../lib/security.js';
import { TRASH_GLOB_IGNORE } from '../lib/trash.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { ok, mapToolError, type NoteMetadata } from '../types/index.js';

export function listRecentHandler(config: Config) {
  return async ({
    limit,
    folder,
    includeOperational,
  }: {
    limit?: number;
    folder?: string;
    includeOperational?: boolean;
  }) => {
    try {
      const effectiveLimit = Math.min(limit ?? 10, 100);
      const baseDir = folder ? resolveDir(config.vaultPath, folder) : config.vaultPath;
      const effectiveIncludeOperational = includeOperational ?? false;

      if (folder) {
        assertSafePath(config.vaultPath, baseDir);
      }

      const files = await fg('**/*.md', {
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

      notes.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

      return ok({ notes: notes.slice(0, effectiveLimit) });
    } catch (e) {
      return mapToolError(e, { path: folder });
    }
  };
}
