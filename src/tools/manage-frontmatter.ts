import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, assertFileSize } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter, mergeFrontmatter } from '../lib/frontmatter.js';
import { withUpdatedTimestampUnlessProvided } from '../lib/timestamps.js';
import { clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { logger } from '../lib/logger.js';
import { ok, err, mapToolError } from '../types/index.js';

export function validateFrontmatterOperation(
  operation: 'set' | 'merge' | 'delete',
  data?: Record<string, unknown>,
  keys?: string[],
): string | null {
  if (operation === 'set') {
    if (data === undefined || Object.keys(data).length === 0) {
      return 'operation "set" requires frontmatter with at least one field (e.g. { title: "...", updated: "..." })';
    }
  } else if (operation === 'merge') {
    if (data === undefined || Object.keys(data).length === 0) {
      return 'operation "merge" requires frontmatter with at least one field';
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
  }: {
    path: string;
    operation: 'set' | 'merge' | 'delete';
    data?: Record<string, unknown>;
    keys?: string[];
  }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);
      await assertFileSize(resolved, config.maxFileSize);

      const raw = await fs.readFile(resolved, 'utf-8');
      const { data: existing, content } = parseFrontmatter(raw);

      const validationError = validateFrontmatterOperation(operation, data, keys);
      if (validationError) {
        return err(validationError, 'invalid_args', { path: notePath });
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
      await fs.writeFile(resolved, newContent, 'utf-8');

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Frontmatter updated', { path: relative, operation });

      return ok({ path: relative, operation, frontmatter: updated });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
