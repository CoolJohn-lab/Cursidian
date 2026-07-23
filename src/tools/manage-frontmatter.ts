import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { assertNotReadOnly, readFileBounded } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter, mergeFrontmatter } from '../lib/frontmatter.js';
import {
  computeContentHash,
  computeRevisionHash,
  checkRevisionConcurrency,
  hashMismatchDetails,
} from '../lib/content-hash.js';
import { withUpdatedTimestampUnlessProvided } from '../lib/timestamps.js';
import { resolveExistingNotePath } from '../lib/vault-index.js';
import { withPathLock, atomicReplaceLocked } from '../lib/vault-io.js';
import { OperationJournal, mergeOperationWarnings } from '../lib/operation-journal.js';
import { MAX_FRONTMATTER_KEYS } from '../lib/limits.js';
import { logger } from '../lib/logger.js';
import { ok, invalidArgsError, toolError, mapToolError } from '../types/index.js';

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
    expectedRevision,
    expectedHash,
  }: {
    path: string;
    operation: 'set' | 'merge' | 'delete';
    data?: Record<string, unknown>;
    keys?: string[];
    replaceAll?: boolean;
    expectedRevision?: string;
    expectedHash?: string;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);

      const validationError = validateFrontmatterOperation(operation, data, keys, replaceAll);
      if (validationError) {
        const required =
          operation === 'set'
            ? ['path', 'fmOperation', 'frontmatter', 'replaceAll']
            : operation === 'merge'
              ? ['path', 'fmOperation', 'frontmatter']
              : ['path', 'fmOperation', 'keys'];
        const missing = [
          ...(data === undefined && operation !== 'delete' ? ['frontmatter'] : []),
          ...(operation === 'set' && replaceAll !== true ? ['replaceAll'] : []),
          ...(operation === 'delete' && (!keys || keys.length === 0) ? ['keys'] : []),
        ];
        const rejected =
          data && Object.keys(data).length > MAX_FRONTMATTER_KEYS ? ['frontmatter'] : [];
        return invalidArgsError({
          tool: 'note',
          action: 'frontmatter',
          message: validationError,
          required,
          missing,
          rejected,
          path: notePath,
          arguments: {
            action: 'frontmatter',
            path: notePath,
            fmOperation: operation,
            ...(operation === 'delete'
              ? { keys: keys ?? ['<key>'] }
              : { frontmatter: data ?? { '<key>': '<value>' } }),
            ...(operation === 'set' ? { replaceAll: true } : {}),
          },
        });
      }

      return await withPathLock(resolved, async () => {
        const journal = await OperationJournal.begin(config.vaultPath, {
          backupEnabled: config.backupEnabled,
          tool: 'note',
          action: 'frontmatter',
        });

        try {
          const raw = await readFileBounded(resolved, config.maxFileSize);
          const { data: existing, content } = parseFrontmatter(raw);

          const revisionCheck = checkRevisionConcurrency({
            raw,
            body: content,
            expectedRevision,
            expectedHash,
          });
          if (!revisionCheck.ok) {
            await journal.abort();
            return toolError({
              error: 'hash_mismatch',
              message: revisionCheck.message,
              action: 'frontmatter',
              retryable: true,
              sideEffects: 'none',
              path: notePath,
              details: hashMismatchDetails(revisionCheck),
              recovery: { tool: 'note', arguments: { action: 'read', path: notePath } },
              hint: revisionCheck.hint,
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

          await journal.recordBefore(resolved, config.maxFileSize);
          await atomicReplaceLocked(config.vaultPath, resolved, newContent, config.maxFileSize);

          const relative = toRelativePath(config.vaultPath, resolved);
          await journal.recordAfter(relative, computeRevisionHash(newContent));
          const op = await journal.finalize();

          logger.info('Frontmatter updated', { path: relative, operation });

          const warnings = mergeOperationWarnings(revisionCheck.warnings, op);

          return ok(
            {
              path: relative,
              operation,
              frontmatter: updated,
              contentHash: computeContentHash(content),
              revisionHash: computeRevisionHash(newContent),
              ...(warnings ? { warnings } : {}),
            },
            {
              action: 'frontmatter',
              changed: true,
              paths: [relative],
              warnings,
              operationId: op.operationId,
              undoAvailable: op.undoAvailable,
            },
          );
        } catch (e) {
          await journal.abort();
          throw e;
        }
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'note',
        action: 'frontmatter',
        path: notePath,
        arguments: { action: 'read', path: notePath },
      });
    }
  };
}
