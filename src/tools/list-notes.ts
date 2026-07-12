import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { type Config } from '../config.js';
import { resolveDir, toRelativePath } from '../lib/vault.js';
import { assertSafePath } from '../lib/security.js';
import { TRASH_GLOB_IGNORE } from '../lib/trash.js';
import { ok, mapToolError, type NoteMetadata } from '../types/index.js';

export function listNotesHandler(config: Config) {
  return async ({ folder, recursive }: { folder?: string; recursive?: boolean }) => {
    try {
      const baseDir = folder ? resolveDir(config.vaultPath, folder) : config.vaultPath;
      const isRecursive = recursive ?? true;

      if (folder) {
        assertSafePath(config.vaultPath, baseDir);
      }

      const pattern = isRecursive ? '**/*.md' : '*.md';
      const files = await fg(pattern, {
        cwd: baseDir,
        absolute: true,
        dot: false,
        ignore: [TRASH_GLOB_IGNORE],
      });

      const notes: NoteMetadata[] = await Promise.all(
        files.map(async (file) => {
          const stat = await fs.stat(file);
          const relativePath = toRelativePath(config.vaultPath, file);
          return {
            path: relativePath,
            name: path.basename(file, '.md'),
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          };
        }),
      );

      notes.sort((a, b) => a.path.localeCompare(b.path));

      return ok({ count: notes.length, notes });
    } catch (e) {
      return mapToolError(e, { path: folder });
    }
  };
}
