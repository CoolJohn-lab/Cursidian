import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolveDir, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync } from '../lib/security.js';
import { vaultGlob } from '../lib/vault-glob.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { getVaultSnapshot } from '../lib/vault-snapshot.js';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../lib/limits.js';
import { paginateByPath, resolveCursorMarker, scanMetadataFromSkipped } from '../lib/pagination.js';
import { ok, err, mapToolError, type NoteMetadata } from '../types/index.js';

export function listNotesHandler(config: Config) {
  return async ({
    folder,
    recursive,
    includeOperational,
    limit,
    cursor,
  }: {
    folder?: string;
    recursive?: boolean;
    includeOperational?: boolean;
    limit?: number;
    cursor?: string;
  }) => {
    try {
      const baseDir = folder ? resolveDir(config.vaultPath, folder) : config.vaultPath;
      const isRecursive = recursive ?? true;
      const effectiveIncludeOperational = includeOperational ?? false;
      const pageSize = Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

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
      const marker = resolveCursorMarker(cursor, snapshot.signature, {
        vaultPath: config.vaultPath,
      });

      const pattern = isRecursive ? '**/*.md' : '*.md';
      const files = await vaultGlob(config.vaultPath, pattern, { cwd: baseDir });

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

      const paged = paginateByPath(notes, pageSize, marker, snapshot.signature);
      const scan = scanMetadataFromSkipped(snapshot.skipped);

      return ok({
        count: paged.totalMatches,
        notes: paged.page,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        effectiveLimit: pageSize,
        folder: folder ?? null,
        includeOperational: effectiveIncludeOperational,
        recursive: isRecursive,
        ...scan,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'search',
        action: 'list',
        path: folder,
        arguments: {
          action: 'list',
          ...(folder ? { folder } : {}),
          limit: limit ?? DEFAULT_LIST_LIMIT,
          includeOperational: includeOperational ?? false,
        },
      });
    }
  };
}
