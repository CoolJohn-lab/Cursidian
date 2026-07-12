import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import {
  assertSafePathAsync,
  assertNotReadOnly,
  readFileBounded,
} from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash, computeRevisionHash, checkRevisionConcurrency } from '../lib/content-hash.js';
import { applyPatch, assertReplaceSizeGuard, replaceSection } from '../lib/section-edit.js';
import { withUpdatedTimestamp } from '../lib/timestamps.js';
import { clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { withPathLock, atomicReplaceLocked } from '../lib/vault-io.js';
import { OperationJournal, mergeOperationWarnings } from '../lib/operation-journal.js';
import { logger } from '../lib/logger.js';
import { ok, invalidArgsError, toolError, mapToolError } from '../types/index.js';

type UpdateMode = 'replace' | 'append' | 'prepend' | 'patch' | 'replace_section';

export function resolveEffectiveUpdateMode(
  mode: UpdateMode | undefined,
  old_string: string | undefined,
  new_string: string | undefined,
): UpdateMode {
  const requested = mode ?? 'replace';
  if (
    requested === 'replace' &&
    old_string !== undefined &&
    new_string !== undefined
  ) {
    return 'patch';
  }
  return requested;
}

export function updateNoteHandler(config: Config) {
  return async ({
    path: notePath,
    content,
    mode,
    old_string,
    new_string,
    heading,
    expectedRevision,
    expectedHash,
    force,
  }: {
    path: string;
    content?: string;
    mode?: UpdateMode;
    old_string?: string;
    new_string?: string;
    heading?: string;
    expectedRevision?: string;
    expectedHash?: string;
    force?: boolean;
  }) => {
    const invalidUpdate = (message: string, required: string[], missing: string[]) =>
      invalidArgsError({
        tool: 'note',
        action: 'update',
        message,
        required,
        missing,
        rejected: [],
        path: notePath,
        arguments: {
          action: 'update',
          path: notePath,
          mode: mode ?? 'replace',
          ...Object.fromEntries(required.filter((name) => name !== 'path').map((name) => [name, `<${name}>`])),
        },
      });
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      return await withPathLock(resolved, async () => {
        const journal = await OperationJournal.begin(config.vaultPath, {
          backupEnabled: config.backupEnabled,
          tool: 'note',
          action: 'update',
        });

        try {
          const raw = await readFileBounded(resolved, config.maxFileSize);
          const { data, content: existingContent } = parseFrontmatter(raw);

          const revisionCheck = checkRevisionConcurrency({
            raw,
            body: existingContent,
            expectedRevision,
            expectedHash,
          });
          if (!revisionCheck.ok) {
            await journal.abort();
            return toolError({
              error: 'hash_mismatch',
              message: revisionCheck.message,
              action: 'update',
              retryable: true,
              sideEffects: 'none',
              path: notePath,
              details: { check: expectedRevision ? 'revision' : 'content_hash' },
              recovery: { tool: 'note', arguments: { action: 'read', path: notePath } },
              hint: revisionCheck.hint,
            });
          }

          const effectiveMode = resolveEffectiveUpdateMode(mode, old_string, new_string);
          let updatedBody: string;

          if (effectiveMode === 'patch') {
            if (old_string === undefined || new_string === undefined) {
              await journal.abort();
              const missing = [
                ...(old_string === undefined ? ['old_string'] : []),
                ...(new_string === undefined ? ['new_string'] : []),
              ];
              return invalidUpdate(
                'mode "patch" requires old_string and new_string',
                ['path', 'old_string', 'new_string'],
                missing,
              );
            }
            updatedBody = applyPatch(existingContent, old_string, new_string);
          } else if (effectiveMode === 'replace_section') {
            if (!heading) {
              await journal.abort();
              return invalidUpdate(
                'mode "replace_section" requires heading',
                ['path', 'heading', 'content'],
                ['heading'],
              );
            }
            if (content === undefined) {
              await journal.abort();
              return invalidUpdate(
                'mode "replace_section" requires content',
                ['path', 'heading', 'content'],
                ['content'],
              );
            }
            updatedBody = replaceSection(existingContent, heading, content);
          } else if (effectiveMode === 'replace') {
            if (content === undefined) {
              await journal.abort();
              return invalidUpdate('mode "replace" requires content', ['path', 'content'], ['content']);
            }
            assertReplaceSizeGuard(existingContent, content, force ?? false);
            updatedBody = content;
          } else if (effectiveMode === 'append') {
            if (content === undefined) {
              await journal.abort();
              return invalidUpdate('mode "append" requires content', ['path', 'content'], ['content']);
            }
            updatedBody = `${existingContent}\n${content}`;
          } else {
            if (content === undefined) {
              await journal.abort();
              return invalidUpdate('mode "prepend" requires content', ['path', 'content'], ['content']);
            }
            updatedBody = `${content}\n${existingContent}`;
          }

          const newBody = stringifyFrontmatter(withUpdatedTimestamp(data), updatedBody);

          await journal.recordBefore(resolved, config.maxFileSize);
          await atomicReplaceLocked(config.vaultPath, resolved, newBody, config.maxFileSize);

          const relative = toRelativePath(config.vaultPath, resolved);
          await journal.recordAfter(relative, computeRevisionHash(newBody));
          const op = await journal.finalize();

          clearAllSearchCaches();
          logger.info('Note updated', { path: relative, mode: effectiveMode });

          const warnings = mergeOperationWarnings(revisionCheck.warnings, op);

          return ok({
            updated: relative,
            mode: effectiveMode,
            inferredMode: effectiveMode !== (mode ?? 'replace') ? effectiveMode : undefined,
            contentHash: computeContentHash(updatedBody),
            revisionHash: computeRevisionHash(newBody),
            ...(warnings ? { warnings } : {}),
          }, {
            action: 'update',
            changed: true,
            paths: [relative],
            warnings,
            operationId: op.operationId,
            undoAvailable: op.undoAvailable,
          });
        } catch (e) {
          await journal.abort();
          throw e;
        }
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'note',
        action: 'update',
        path: notePath,
        arguments: { action: 'read', path: notePath },
      });
    }
  };
}
