import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertNotReadOnly, assertSafePathAsync, readFileBounded } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { buildIndexSyncPayload } from '../lib/vault-health.js';
import { withUpdatedTimestamp } from '../lib/timestamps.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { atomicWriteLocked } from '../lib/vault-io.js';
import {
  mergeJournaledWarnings,
  runJournaledMultiFileOperation,
} from '../lib/multi-file-operation.js';
import { ok, mapToolError } from '../types/index.js';

const INDEX_PATH = 'index.md';

export function syncIndexHandler(config: Config) {
  return async ({ dryRun }: { dryRun?: boolean }) => {
    try {
      const effectiveDryRun = dryRun ?? false;
      const { markdown, noteCount, categories, indexMode } = await buildIndexSyncPayload(
        config.vaultPath,
        config.maxFileSize,
      );

      const resolved = resolvePath(config.vaultPath, INDEX_PATH);
      await assertSafePathAsync(config.vaultPath, resolved);

      if (effectiveDryRun) {
        let wouldWrite = true;
        try {
          const existingRaw = await readFileBounded(resolved, config.maxFileSize);
          const existingBody = parseFrontmatter(existingRaw)
            .content.replace(/\r\n/g, '\n')
            .trimEnd();
          const nextBody = markdown.replace(/\r\n/g, '\n').trimEnd();
          wouldWrite = existingBody !== nextBody;
        } catch {
          wouldWrite = true;
        }
        return ok(
          { wouldWrite, markdown, noteCount, categories, indexMode },
          { action: 'sync_index', changed: false },
        );
      }

      assertNotReadOnly(config.readOnly);

      let existingFm: Record<string, unknown> = { title: 'Wiki Index' };
      try {
        const raw = await readFileBounded(resolved, config.maxFileSize);
        existingFm = parseFrontmatter(raw).data;
      } catch {
        // index.md will be created
      }

      const frontmatter = withUpdatedTimestamp({
        ...existingFm,
        title: 'Wiki Index',
        ...(indexMode === 'hub' ? { indexMode: 'hub' } : {}),
      });
      const body = stringifyFrontmatter(frontmatter, markdown);

      const journaled = await runJournaledMultiFileOperation(config, {
        tool: 'vault',
        action: 'sync_index',
        lockPaths: [resolved],
        snapshotPaths: [resolved],
        run: async ({ tracker, recordAfter, readRevision }) => {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await atomicWriteLocked(config.vaultPath, resolved, body, config.maxFileSize);
          tracker.recordWrite(INDEX_PATH);
          await recordAfter(INDEX_PATH, await readRevision(resolved));
          return {
            updated: toRelativePath(config.vaultPath, resolved),
            noteCount,
            categories,
            indexMode,
          };
        },
      });

      clearAllSearchCaches();

      const warnings = mergeJournaledWarnings(undefined, journaled);

      return ok(journaled.value, {
        action: 'sync_index',
        changed: true,
        paths: [INDEX_PATH],
        warnings,
        operationId: journaled.operationId,
        undoAvailable: journaled.undoAvailable,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'vault',
        action: 'sync_index',
        arguments: { action: 'sync_index', dryRun },
      });
    }
  };
}
