import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolveDir, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync } from '../lib/security.js';
import { vaultGlob } from '../lib/vault-glob.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { MAX_RECENT_LIMIT } from '../lib/limits.js';
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
      const effectiveLimit = Math.min(limit ?? 10, MAX_RECENT_LIMIT);
      const baseDir = folder ? resolveDir(config.vaultPath, folder) : config.vaultPath;
      const effectiveIncludeOperational = includeOperational ?? false;

      if (folder) {
        await assertSafePathAsync(config.vaultPath, baseDir);
      }

      const files = await vaultGlob(config.vaultPath, '**/*.md', { cwd: baseDir });

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

      return ok({ notes: notes.slice(0, effectiveLimit), effectiveLimit });
    } catch (e) {
      return mapToolError(e, { path: folder });
    }
  };
}
