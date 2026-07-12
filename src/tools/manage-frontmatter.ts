import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import {
  assertNotReadOnly,
  readFileBounded,
} from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter, mergeFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash } from '../lib/content-hash.js';
import { withUpdatedTimestampUnlessProvided } from '../lib/timestamps.js';
import { clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { atomicReplace } from '../lib/vault-io.js';
import { backupNoteIfExists } from '../lib/backup.js';
import { MAX_FRONTMATTER_KEYS } from '../lib/limits.js';
import { logger } from '../lib/logger.js';
import { ok, err, toolError, mapToolError } from '../types/index.js';

export function validateFrontmatterOperation(
  operation: 'set' | 'merge' | 'delete',
  data?: Record<string, unknown>,
  keys?: string[],
  replaceAll?: boolean,
): string | null {
  if (operation === 'set') {
    if (data === undefined || Object.keys(data).length === 0) {
      return 'operation "set" requires frontmatter with at least one field (e.g. { title: "...", updated: "..." })';
    }
    if (!replaceAll) {
      return 'operation "set" replaces all frontmatter keys; pass replaceAll: true to confirm, or use merge instead';
    }
    if (Object.keys(data).length > MAX_FRONTMATTER_KEYS) {
      return `frontmatter has too many keys (max ${MAX_FRONTMATTER_KEYS})`;
    }
  } else if (operation === 'merge') {
    if (data === undefined || Object.keys(data).length === 0) {
      return 'operation "merge" requires frontmatter with at least one field';
    }
    if (Object.keys(data).length > MAX_FRONTMATTER_KEYS) {
      return `frontmatter has too many keys (max ${MAX_FRONTMATTER_KEYS})`;
    }
  } else if (operation === 'delete') {
    if (keys === undefined || keys.length === 0) {
      return 'operation "delete" requires a non-empty keys array';
    }
  }
  return null;
}

export function manageFrontmatterHandler(config: Config) {
  return async ({
    path: notePath,
    operation,
    data,
    keys,
    replaceAll,
    expectedHash,
  }: {
    path: string;
    operation: 'set' | 'merge' | 'delete';
    data?: Record<string, unknown>;
    keys?: string[];
    replaceAll?: boolean;
    expectedHash?: string;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);

      const validationError = validateFrontmatterOperation(operation, data, keys, replaceAll);
      if (validationError) {
        return err(validationError, 'invalid_args', { path: notePath });
      }

      const raw = await readFileBounded(resolved, config.maxFileSize);
      const { data: existing, content } = parseFrontmatter(raw);

      const currentHash = computeContentHash(content);
      if (expectedHash && expectedHash !== currentHash) {
        return toolError({
          error: 'hash_mismatch',
          message:
            'Note content has changed since read (hash mismatch). Re-read the note and retry with the latest contentHash.',
          path: notePath,
          hint: 'Call note with action read again, then pass the fresh contentHash as expectedHash.',
        });
      }

      let updated: Record<string, unknown>;

      if (operation === 'set') {
        updated = data as Record<string, unknown>;
      } else if (operation === 'merge') {
        updated = mergeFrontmatter(existing, data as Record<string, unknown>);
      } else {
        updated = { ...existing };
        for (const key of keys as string[]) {
          delete updated[key];
        }
      }

      updated = withUpdatedTimestampUnlessProvided(updated, data, undefined);

      const newContent = stringifyFrontmatter(updated, content);

      if (config.backupEnabled) {
        await backupNoteIfExists(config.vaultPath, resolved);
      }

      await atomicReplace(config.vaultPath, resolved, newContent, config.maxFileSize);

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Frontmatter updated', { path: relative, operation });

      return ok({
        path: relative,
        operation,
        frontmatter: updated,
        contentHash: computeContentHash(content),
      });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
