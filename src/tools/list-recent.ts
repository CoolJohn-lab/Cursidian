import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolveDir, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync } from '../lib/security.js';
import { vaultGlob } from '../lib/vault-glob.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { getVaultSnapshot } from '../lib/vault-snapshot.js';
import { MAX_RECENT_LIMIT } from '../lib/limits.js';
import { paginateByPath, resolveCursorMarker, scanMetadataFromSkipped } from '../lib/pagination.js';
import { ok, err, mapToolError, type NoteMetadata } from '../types/index.js';

export function listRecentHandler(config: Config) {
  return async ({
    limit,
    folder,
    includeOperational,
    cursor,
  }: {
    limit?: number;
    folder?: string;
    includeOperational?: boolean;
    cursor?: string;
  }) => {
    try {
      const effectiveLimit = Math.min(limit ?? 10, MAX_RECENT_LIMIT);
      const baseDir = folder ? resolveDir(config.vaultPath, folder) : config.vaultPath;
      const effectiveIncludeOperational = includeOperational ?? false;

      if (folder) {
        await assertSafePathAsync(config.vaultPath, baseDir);
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

      const snapshot = await getVaultSnapshot(config.vaultPath, config.maxFileSize);
      const marker = resolveCursorMarker(cursor, snapshot.signature);

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

      const paged = paginateByPath(notes, effectiveLimit, marker, snapshot.signature);
      const scan = scanMetadataFromSkipped(snapshot.skipped);

      return ok({
        notes: paged.page,
        totalMatches: paged.totalMatches,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        effectiveLimit,
        folder: folder ?? null,
        includeOperational: effectiveIncludeOperational,
        ...scan,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'search',
        action: 'recent',
        path: folder,
        arguments: {
          action: 'recent',
          ...(folder ? { folder } : {}),
          limit: limit ?? 10,
          includeOperational: includeOperational ?? false,
        },
      });
    }
  };
}
