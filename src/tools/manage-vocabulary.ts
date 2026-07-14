import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath } from '../lib/vault.js';
import { assertNotReadOnly, assertSafePathAsync, readFileBounded } from '../lib/security.js';
import { atomicWriteLocked } from '../lib/vault-io.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import {
  mergeJournaledWarnings,
  runJournaledMultiFileOperation,
} from '../lib/multi-file-operation.js';
import {
  VOCABULARY_RELATIVE_PATH,
  defaultVocabularyContent,
  emptyVocabulary,
  parseVocabularyMarkdown,
  removePairing,
  removeSynonymContaining,
  serializeVocabulary,
  upsertPairing,
  upsertSynonymGroup,
  type VaultVocabulary,
} from '../lib/vocabulary.js';
import { logger } from '../lib/logger.js';
import { ok, invalidArgsError, mapToolError } from '../types/index.js';

export type VocabularyOperation = 'read' | 'upsert' | 'remove';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export function manageVocabularyHandler(config: Config) {
  return async ({
    vocabularyOperation,
    synonymGroup,
    pairingKey,
    pairingValues,
    removeKind,
    removeKey,
  }: {
    vocabularyOperation: VocabularyOperation;
    synonymGroup?: string[];
    pairingKey?: string;
    pairingValues?: string[];
    removeKind?: 'synonym' | 'pairing';
    removeKey?: string;
  }) => {
    const invalidVocabulary = (
      message: string,
      required: string[],
      missing: string[],
      rejected: string[] = [],
    ) =>
      invalidArgsError({
        tool: 'vault',
        action: 'vocabulary',
        message,
        required,
        missing,
        rejected,
        path: VOCABULARY_RELATIVE_PATH,
        arguments: {
          action: 'vocabulary',
          vocabularyOperation,
          ...Object.fromEntries(
            required.filter((name) => name !== 'vocabularyOperation').map((name) => [name, `<${name}>`]),
          ),
        },
      });

    try {
      const resolved = resolvePath(config.vaultPath, VOCABULARY_RELATIVE_PATH);
      await assertSafePathAsync(config.vaultPath, resolved);

      if (vocabularyOperation === 'read') {
        const exists = await pathExists(resolved);
        if (!exists) {
          return ok(
            { path: VOCABULARY_RELATIVE_PATH, exists: false, vocabulary: emptyVocabulary() },
            { action: 'vocabulary', changed: false, paths: [] },
          );
        }
        const raw = await readFileBounded(resolved, config.maxFileSize);
        const vocabulary = parseVocabularyMarkdown(raw);
        return ok(
          { path: VOCABULARY_RELATIVE_PATH, exists: true, vocabulary },
          { action: 'vocabulary', changed: false, paths: [VOCABULARY_RELATIVE_PATH] },
        );
      }

      assertNotReadOnly(config.readOnly);

      const exists = await pathExists(resolved);
      const priorRaw = exists ? await readFileBounded(resolved, config.maxFileSize) : defaultVocabularyContent();
      let vocabulary: VaultVocabulary = parseVocabularyMarkdown(priorRaw);

      if (vocabularyOperation === 'upsert') {
        if (synonymGroup && synonymGroup.length > 0) {
          try {
            vocabulary = upsertSynonymGroup(vocabulary, synonymGroup);
          } catch (e) {
            return invalidVocabulary(
              e instanceof Error ? e.message : String(e),
              ['vocabularyOperation', 'synonymGroup'],
              [],
              [],
            );
          }
        } else if (pairingKey?.trim() && pairingValues && pairingValues.length > 0) {
          try {
            vocabulary = upsertPairing(vocabulary, pairingKey, pairingValues);
          } catch (e) {
            return invalidVocabulary(
              e instanceof Error ? e.message : String(e),
              ['vocabularyOperation', 'pairingKey', 'pairingValues'],
              [],
              [],
            );
          }
        } else {
          return invalidVocabulary(
            'upsert requires either synonymGroup (2+ words) or pairingKey with pairingValues',
            ['vocabularyOperation'],
            [],
            [],
          );
        }
      } else if (vocabularyOperation === 'remove') {
        if (!removeKind) {
          return invalidVocabulary(
            'remove requires removeKind',
            ['vocabularyOperation', 'removeKind', 'removeKey'],
            ['removeKind'],
          );
        }
        if (!removeKey?.trim()) {
          return invalidVocabulary(
            'remove requires removeKey',
            ['vocabularyOperation', 'removeKind', 'removeKey'],
            ['removeKey'],
          );
        }
        vocabulary =
          removeKind === 'synonym'
            ? removeSynonymContaining(vocabulary, removeKey)
            : removePairing(vocabulary, removeKey);
      } else {
        return invalidVocabulary(
          `Unknown vocabularyOperation: ${vocabularyOperation}`,
          ['vocabularyOperation'],
          [],
          ['vocabularyOperation'],
        );
      }

      const nextContent = serializeVocabulary(vocabulary, exists ? priorRaw : undefined);

      const journaled = await runJournaledMultiFileOperation(config, {
        tool: 'vault',
        action: 'vocabulary',
        lockPaths: [resolved],
        snapshotPaths: [resolved],
        run: async ({ recordAfter, readRevision, tracker }) => {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await atomicWriteLocked(config.vaultPath, resolved, nextContent, config.maxFileSize);
          tracker.recordWrite(VOCABULARY_RELATIVE_PATH);
          const revision = await readRevision(resolved);
          await recordAfter(VOCABULARY_RELATIVE_PATH, revision);

          return {
            path: VOCABULARY_RELATIVE_PATH,
            vocabulary,
            revisionHash: revision,
          };
        },
      });

      clearAllSearchCaches();
      logger.info('Vocabulary updated', { operation: vocabularyOperation });

      const warnings = mergeJournaledWarnings(undefined, journaled);

      return ok(journaled.value, {
        action: 'vocabulary',
        changed: true,
        paths: [VOCABULARY_RELATIVE_PATH],
        warnings,
        operationId: journaled.operationId,
        undoAvailable: journaled.undoAvailable,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'vault',
        action: 'vocabulary',
        path: VOCABULARY_RELATIVE_PATH,
        arguments: { action: 'vocabulary', vocabularyOperation },
      });
    }
  };
}
