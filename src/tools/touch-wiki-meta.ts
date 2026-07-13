import { type Config } from '../config.js';
import { resolvePath } from '../lib/vault.js';
import {
  assertSafePathAsync,
  assertNotReadOnly,
  readFileBounded,
} from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash, computeRevisionHash } from '../lib/content-hash.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { atomicReplaceLocked } from '../lib/vault-io.js';
import {
  mergeJournaledWarnings,
  runJournaledMultiFileOperation,
} from '../lib/multi-file-operation.js';
import { MAX_LOG_LINE_LENGTH } from '../lib/limits.js';
import { logger } from '../lib/logger.js';
import { ok, toolError, mapToolError } from '../types/index.js';

const LOG_PATH = 'log.md';
const HOT_PATH = 'hot.md';
const MAX_HOT_ACTIVITY = 3;

function normaliseLogLine(line: string, timestamp: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('- [')) {
    return trimmed;
  }
  if (trimmed.startsWith('[')) {
    return `- ${trimmed}`;
  }
  return `- [${timestamp}] ${trimmed}`;
}

function insertHotActivity(body: string, activity: string, timestamp: string): string {
  const bullet = activity.trim().startsWith('- ')
    ? activity.trim()
    : `- [${timestamp}] ${activity.trim()}`;

  const headingRe = /(##\s+Recent Activity[^\n]*\n)([\s\S]*?)(?=\n##\s|\s*$)/i;
  const match = body.match(headingRe);
  if (!match || match.index === undefined) {
    const suffix = `\n\n## Recent Activity\n${bullet}\n`;
    return `${body.trimEnd()}${suffix}`;
  }

  const heading = match[1];
  const sectionBody = match[2];
  const existingBullets = sectionBody
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().startsWith('- '));
  const nextBullets = [bullet, ...existingBullets].slice(0, MAX_HOT_ACTIVITY);
  const rebuilt = `${heading}${nextBullets.join('\n')}\n`;
  return body.slice(0, match.index) + rebuilt + body.slice(match.index + match[0].length);
}

function bumpHotUpdated(
  data: Record<string, unknown>,
  timestamp: string,
): Record<string, unknown> {
  return { ...data, updated: timestamp };
}

export function touchWikiMetaHandler(config: Config) {
  return async ({
    logLine,
    hotActivity,
    expectedLogHash,
    expectedHotHash,
  }: {
    logLine: string;
    hotActivity?: string;
    expectedLogHash?: string;
    expectedHotHash?: string;
  }) => {
    try {
      assertNotReadOnly(config.readOnly);

      if (logLine.length > MAX_LOG_LINE_LENGTH) {
        return toolError({
          error: 'invalid_args',
          message: `logLine exceeds ${MAX_LOG_LINE_LENGTH} characters.`,
          action: 'log',
          retryable: true,
          sideEffects: 'none',
          recovery: { tool: 'vault', arguments: { action: 'log', logLine: '<shorter-line>' } },
        });
      }
      if (hotActivity && hotActivity.length > MAX_LOG_LINE_LENGTH) {
        return toolError({
          error: 'invalid_args',
          message: `hotActivity exceeds ${MAX_LOG_LINE_LENGTH} characters.`,
          action: 'log',
          retryable: true,
          sideEffects: 'none',
          recovery: { tool: 'vault', arguments: { action: 'log', logLine, hotActivity: '<shorter-line>' } },
        });
      }

      const timestamp = new Date().toISOString();
      const normalisedLog = normaliseLogLine(logLine, timestamp);

      const logResolved = resolvePath(config.vaultPath, LOG_PATH);
      const hotResolved = resolvePath(config.vaultPath, HOT_PATH);
      await assertSafePathAsync(config.vaultPath, logResolved);

      const touchHot = hotActivity !== undefined && hotActivity.trim() !== '';
      const lockPaths = touchHot ? [logResolved, hotResolved] : [logResolved];
      const snapshotPaths = touchHot ? [logResolved, hotResolved] : [logResolved];

      const journaled = await runJournaledMultiFileOperation(config, {
        tool: 'vault',
        action: 'log',
        lockPaths,
        snapshotPaths,
        run: async ({ tracker, recordAfter, readRevision }) => {
          const logRaw = await readFileBounded(logResolved, config.maxFileSize);
          const { data: logData, content: logBody } = parseFrontmatter(logRaw);
          const logHash = computeContentHash(logBody);
          if (expectedLogHash && expectedLogHash !== logHash) {
            throw Object.assign(new Error(
              'log.md content has changed since read (hash mismatch). Re-read and retry with the latest contentHash.',
            ), {
              hashMismatch: true,
              path: LOG_PATH,
              hint: 'Call note with action read on log.md, then pass the fresh contentHash as expectedLogHash.',
            });
          }

          let hotOutput: string | undefined;
          let updatedHotBody: string | undefined;

          if (touchHot) {
            await assertSafePathAsync(config.vaultPath, hotResolved);
            const hotRaw = await readFileBounded(hotResolved, config.maxFileSize);
            const { data: hotData, content: hotBody } = parseFrontmatter(hotRaw);
            const hotHash = computeContentHash(hotBody);
            if (expectedHotHash && expectedHotHash !== hotHash) {
              throw Object.assign(new Error(
                'hot.md content has changed since read (hash mismatch). Re-read and retry with the latest contentHash.',
              ), {
                hashMismatch: true,
                path: HOT_PATH,
                hint: 'Call note with action read on hot.md, then pass the fresh contentHash as expectedHotHash.',
              });
            }

            updatedHotBody = insertHotActivity(hotBody, hotActivity as string, timestamp);
            const updatedHotData = bumpHotUpdated(hotData, timestamp);
            hotOutput = stringifyFrontmatter(updatedHotData, updatedHotBody);
          }

          const updatedLogBody = `${logBody.trimEnd()}\n${normalisedLog}\n`;
          const logOutput = stringifyFrontmatter(logData, updatedLogBody);

          await atomicReplaceLocked(config.vaultPath, logResolved, logOutput, config.maxFileSize);
          tracker.recordWrite(LOG_PATH);
          await recordAfter(LOG_PATH, await readRevision(logResolved));

          const result: {
            log: { path: string; contentHash: string; line: string };
            hot?: { path: string; contentHash: string };
          } = {
            log: {
              path: LOG_PATH,
              contentHash: computeContentHash(updatedLogBody),
              line: normalisedLog,
            },
          };

          if (hotOutput && updatedHotBody) {
            await atomicReplaceLocked(config.vaultPath, hotResolved, hotOutput, config.maxFileSize);
            tracker.recordWrite(HOT_PATH);
            await recordAfter(HOT_PATH, computeRevisionHash(hotOutput));
            result.hot = {
              path: HOT_PATH,
              contentHash: computeContentHash(updatedHotBody),
            };
          }

          return result;
        },
      });

      clearAllSearchCaches();
      logger.info('Wiki meta touched', {
        log: true,
        hot: Boolean(journaled.value.hot),
      });

      const warnings = mergeJournaledWarnings(undefined, journaled);

      return ok(journaled.value, {
        action: 'log',
        changed: true,
        paths: journaled.value.hot ? [LOG_PATH, HOT_PATH] : [LOG_PATH],
        warnings,
        operationId: journaled.operationId,
        undoAvailable: journaled.undoAvailable,
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'hashMismatch' in e && (e as { hashMismatch: boolean }).hashMismatch) {
        return toolError({
          error: 'hash_mismatch',
          message: e instanceof Error ? e.message : String(e),
          action: 'log',
          retryable: true,
          sideEffects: 'none',
          path: 'path' in e ? String((e as { path: string }).path) : LOG_PATH,
          details: {
            conflictKind: 'revision',
            ...('currentRevision' in e && typeof (e as { currentRevision: unknown }).currentRevision === 'string'
              ? { currentRevision: (e as { currentRevision: string }).currentRevision }
              : {}),
          },
          recovery: { tool: 'note', arguments: { action: 'read', path: LOG_PATH } },
          hint: 'hint' in e ? String((e as { hint: string }).hint) : undefined,
        });
      }

      return mapToolError(e, {
        tool: 'vault',
        action: 'log',
        arguments: { action: 'log', logLine, hotActivity },
      });
    }
  };
}
