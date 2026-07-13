import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath } from '../lib/vault.js';
import {
  assertNotReadOnly,
  assertSafePathAsync,
  readFileBounded,
} from '../lib/security.js';
import { computeRevisionHash, checkRevisionConcurrency } from '../lib/content-hash.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { atomicWriteLocked } from '../lib/vault-io.js';
import {
  mergeJournaledWarnings,
  runJournaledMultiFileOperation,
} from '../lib/multi-file-operation.js';
import {
  MANIFEST_RELATIVE_PATH,
  defaultManifestContent,
  emptyManifestRecord,
  normalizeSourceKey,
  parseManifest,
  removeManifestEntry,
  serializeManifest,
  toManifestRecord,
  upsertProject,
  upsertSource,
} from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { ok, invalidArgsError, toolError, mapToolError } from '../types/index.js';

export type ManifestOperation = 'read' | 'upsert_source' | 'upsert_project' | 'remove';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export function manageManifestHandler(config: Config) {
  return async ({
    manifestOperation,
    expectedRevision,
    sourceKey,
    sourceIngested,
    sourceMtime,
    sourcePages,
    projectName,
    projectCwd,
    projectLastCommit,
    projectSynced,
    removeKind,
    removeKey,
  }: {
    manifestOperation: ManifestOperation;
    expectedRevision?: string;
    sourceKey?: string;
    sourceIngested?: string;
    sourceMtime?: string;
    sourcePages?: string[];
    projectName?: string;
    projectCwd?: string;
    projectLastCommit?: string;
    projectSynced?: string;
    removeKind?: 'source' | 'project';
    removeKey?: string;
  }) => {
    const invalidManifest = (
      message: string,
      required: string[],
      missing: string[],
      rejected: string[] = [],
    ) =>
      invalidArgsError({
        tool: 'vault',
        action: 'manifest',
        message,
        required,
        missing,
        rejected,
        path: MANIFEST_RELATIVE_PATH,
        arguments: {
          action: 'manifest',
          manifestOperation,
          ...Object.fromEntries(required.filter((name) => name !== 'manifestOperation').map((name) => [name, `<${name}>`])),
        },
      });

    try {
      const resolved = resolvePath(config.vaultPath, MANIFEST_RELATIVE_PATH);
      await assertSafePathAsync(config.vaultPath, resolved);

      if (manifestOperation === 'read') {
        const exists = await pathExists(resolved);
        if (!exists) {
          return ok(
            {
              path: MANIFEST_RELATIVE_PATH,
              exists: false,
              manifest: emptyManifestRecord(),
            },
            { action: 'manifest', changed: false, paths: [] },
          );
        }

        const raw = await readFileBounded(resolved, config.maxFileSize);
        const parsed = parseManifest(raw);
        return ok(
          {
            path: MANIFEST_RELATIVE_PATH,
            exists: true,
            revisionHash: computeRevisionHash(raw),
            manifest: toManifestRecord(parsed),
          },
          { action: 'manifest', changed: false, paths: [MANIFEST_RELATIVE_PATH] },
        );
      }

      assertNotReadOnly(config.readOnly);

      const exists = await pathExists(resolved);
      let parsed = exists
        ? parseManifest(await readFileBounded(resolved, config.maxFileSize))
        : parseManifest(defaultManifestContent());

      if (manifestOperation === 'upsert_source') {
        if (!sourceKey?.trim()) {
          return invalidManifest('upsert_source requires sourceKey', ['manifestOperation', 'sourceKey', 'sourceIngested'], ['sourceKey']);
        }
        if (!sourceIngested?.trim()) {
          return invalidManifest('upsert_source requires sourceIngested', ['manifestOperation', 'sourceKey', 'sourceIngested'], ['sourceIngested']);
        }
        parsed = upsertSource(parsed, {
          key: normalizeSourceKey(sourceKey),
          ingested: sourceIngested.trim(),
          mtime: sourceMtime?.trim() || undefined,
          pages: sourcePages?.map((page) => page.trim()).filter(Boolean),
        });
      } else if (manifestOperation === 'upsert_project') {
        if (!projectName?.trim()) {
          return invalidManifest('upsert_project requires projectName', ['manifestOperation', 'projectName', 'projectCwd'], ['projectName']);
        }
        if (!projectCwd?.trim()) {
          return invalidManifest('upsert_project requires projectCwd', ['manifestOperation', 'projectName', 'projectCwd'], ['projectCwd']);
        }
        parsed = upsertProject(parsed, {
          name: projectName.trim(),
          cwd: normalizeSourceKey(projectCwd),
          lastCommit: projectLastCommit?.trim() || undefined,
          synced: projectSynced?.trim() || undefined,
        });
      } else if (manifestOperation === 'remove') {
        if (!removeKind) {
          return invalidManifest('remove requires removeKind', ['manifestOperation', 'removeKind', 'removeKey'], ['removeKind']);
        }
        if (!removeKey?.trim()) {
          return invalidManifest('remove requires removeKey', ['manifestOperation', 'removeKind', 'removeKey'], ['removeKey']);
        }
        parsed = removeManifestEntry(parsed, removeKind, removeKey.trim());
      } else {
        return invalidManifest(`Unknown manifestOperation: ${manifestOperation}`, ['manifestOperation'], [], ['manifestOperation']);
      }

      const nextContent = serializeManifest(parsed);

      const journaled = await runJournaledMultiFileOperation(config, {
        tool: 'vault',
        action: 'manifest',
        lockPaths: [resolved],
        snapshotPaths: [resolved],
        run: async ({ recordAfter, readRevision, tracker }) => {
          if (exists) {
            const raw = await readFileBounded(resolved, config.maxFileSize);
            const { content } = parseFrontmatter(raw);
            const revisionCheck = checkRevisionConcurrency({
              raw,
              body: content,
              expectedRevision,
            });
            if (!revisionCheck.ok) {
              throw Object.assign(new Error(revisionCheck.message), {
                hashMismatch: true,
                hint: revisionCheck.hint,
                currentRevision: revisionCheck.currentRevision,
                currentHash: revisionCheck.currentHash,
                check: revisionCheck.check,
              });
            }
          } else if (expectedRevision) {
            throw Object.assign(new Error('Manifest does not exist yet; omit expectedRevision on first write.'), {
              hashMismatch: true,
              hint: 'Call vault manifest with manifestOperation read, or omit expectedRevision to create the file.',
            });
          }

          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await atomicWriteLocked(config.vaultPath, resolved, nextContent, config.maxFileSize);
          tracker.recordWrite(MANIFEST_RELATIVE_PATH);
          const revision = await readRevision(resolved);
          await recordAfter(MANIFEST_RELATIVE_PATH, revision);

          return {
            path: MANIFEST_RELATIVE_PATH,
            manifest: toManifestRecord(parsed),
            revisionHash: revision,
          };
        },
      });

      clearAllSearchCaches();
      logger.info('Manifest updated', { operation: manifestOperation });

      const warnings = mergeJournaledWarnings(undefined, journaled);

      return ok(journaled.value, {
        action: 'manifest',
        changed: true,
        paths: [MANIFEST_RELATIVE_PATH],
        warnings,
        operationId: journaled.operationId,
        undoAvailable: journaled.undoAvailable,
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'hashMismatch' in e && (e as { hashMismatch: boolean }).hashMismatch) {
        return toolError({
          error: 'hash_mismatch',
          message: e instanceof Error ? e.message : String(e),
          action: 'manifest',
          retryable: true,
          sideEffects: 'none',
          path: MANIFEST_RELATIVE_PATH,
          details: {
            conflictKind: 'revision',
            check:
              'check' in e && typeof (e as { check: unknown }).check === 'string'
                ? (e as { check: string }).check
                : 'revision',
            ...('currentRevision' in e && typeof (e as { currentRevision: unknown }).currentRevision === 'string'
              ? { currentRevision: (e as { currentRevision: string }).currentRevision }
              : {}),
            ...('currentHash' in e && typeof (e as { currentHash: unknown }).currentHash === 'string'
              ? { currentHash: (e as { currentHash: string }).currentHash }
              : {}),
          },
          recovery: {
            tool: 'vault',
            arguments: { action: 'manifest', manifestOperation: 'read' },
          },
          hint: 'hint' in e ? String((e as { hint: string }).hint) : undefined,
        });
      }

      return mapToolError(e, {
        tool: 'vault',
        action: 'manifest',
        path: MANIFEST_RELATIVE_PATH,
        arguments: { action: 'manifest', manifestOperation },
      });
    }
  };
}
