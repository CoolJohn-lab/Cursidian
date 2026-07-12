import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, assertFileSize } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash } from '../lib/content-hash.js';
import { applyPatch, assertReplaceSizeGuard, replaceSection } from '../lib/section-edit.js';
import { withUpdatedTimestamp } from '../lib/timestamps.js';
import { clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { logger } from '../lib/logger.js';
import { ok, err, toolError, mapToolError } from '../types/index.js';

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
    expectedHash,
    force,
  }: {
    path: string;
    content?: string;
    mode?: UpdateMode;
    old_string?: string;
    new_string?: string;
    heading?: string;
    expectedHash?: string;
    force?: boolean;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);

      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);
      await assertFileSize(resolved, config.maxFileSize);

      const raw = await fs.readFile(resolved, 'utf-8');
      const { data, content: existingContent } = parseFrontmatter(raw);

      const currentHash = computeContentHash(existingContent);
      if (expectedHash && expectedHash !== currentHash) {
        return toolError({
          error: 'hash_mismatch',
          message:
            'Note content has changed since read (hash mismatch). Re-read the note and retry with the latest contentHash.',
          path: notePath,
          hint: 'Call note with action read again, then pass the fresh contentHash as expectedHash.',
        });
      }

      const effectiveMode = resolveEffectiveUpdateMode(mode, old_string, new_string);
      let updatedBody: string;

      if (effectiveMode === 'patch') {
        if (old_string === undefined || new_string === undefined) {
          return err('mode "patch" requires old_string and new_string', 'invalid_args', { path: notePath });
        }
        updatedBody = applyPatch(existingContent, old_string, new_string);
      } else if (effectiveMode === 'replace_section') {
        if (!heading) {
          return err('mode "replace_section" requires heading', 'invalid_args', { path: notePath });
        }
        if (content === undefined) {
          return err('mode "replace_section" requires content', 'invalid_args', { path: notePath });
        }
        updatedBody = replaceSection(existingContent, heading, content);
      } else if (effectiveMode === 'replace') {
        if (content === undefined) {
          return err('mode "replace" requires content', 'invalid_args', { path: notePath });
        }
        assertReplaceSizeGuard(existingContent, content, force ?? false);
        updatedBody = content;
      } else if (effectiveMode === 'append') {
        if (content === undefined) {
          return err('mode "append" requires content', 'invalid_args', { path: notePath });
        }
        updatedBody = `${existingContent}\n${content}`;
      } else {
        if (content === undefined) {
          return err('mode "prepend" requires content', 'invalid_args', { path: notePath });
        }
        updatedBody = `${content}\n${existingContent}`;
      }

      const newBody = stringifyFrontmatter(withUpdatedTimestamp(data), updatedBody);
      await fs.writeFile(resolved, newBody, 'utf-8');

      const relative = toRelativePath(config.vaultPath, resolved);
      clearAllSearchCaches();
      logger.info('Note updated', { path: relative, mode: effectiveMode });

      return ok({
        updated: relative,
        mode: effectiveMode,
        inferredMode: effectiveMode !== (mode ?? 'replace') ? effectiveMode : undefined,
        contentHash: computeContentHash(updatedBody),
      });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
