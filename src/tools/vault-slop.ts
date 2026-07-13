import { type Config } from '../config.js';
import { assertNotReadOnly, assertSafePathAsync, readFileBounded } from '../lib/security.js';
import { atomicReplaceLocked } from '../lib/vault-io.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { buildIndexMarkdown } from '../lib/vault-health.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { withUpdatedTimestamp } from '../lib/timestamps.js';
import { resolvePath } from '../lib/vault.js';
import {
  mergeJournaledWarnings,
  runJournaledMultiFileOperation,
} from '../lib/multi-file-operation.js';
import { analyzeVaultSlop, type FileSlopPlan, type SlopFinding } from '../lib/slop.js';
import { invalidArgsError, ok, mapToolError } from '../types/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const INDEX_PATH = 'index.md';

function summarizePlan(plan: FileSlopPlan) {
  return {
    path: plan.relativePath,
    bodyCharFixes: plan.bodyCharFixes,
    frontmatterCharFixes: plan.frontmatterCharFixes,
    emojiRemovals: plan.emojiRemovals,
    summaryChanged: plan.summaryChanged,
  };
}

function summarizeFinding(f: SlopFinding) {
  return {
    path: f.path,
    region: f.region,
    code: f.code,
    message: f.message,
    matchText: f.matchText,
  };
}

export function vaultSlopCheckHandler(config: Config) {
  return async () => {
    try {
      const report = await analyzeVaultSlop(config.vaultPath, config.maxFileSize);
      return ok(
        {
          fileCount: report.fileCount,
          wouldChange: report.wouldChange,
          summariesWouldChange: report.summariesWouldChange,
          filesToChange: report.filesToChange.map(summarizePlan),
          findings: report.findings.map(summarizeFinding),
          phraseFindings: report.phraseFindings.map(summarizeFinding),
          incomplete: report.incomplete,
          skipped: report.skipped,
          counts: {
            filesToChange: report.filesToChange.length,
            findings: report.findings.length,
            phraseFindings: report.phraseFindings.length,
            skipped: report.skipped.length,
          },
        },
        { action: 'slop_check', changed: false },
      );
    } catch (e) {
      return mapToolError(e, {
        tool: 'vault',
        action: 'slop_check',
        arguments: { action: 'slop_check' },
      });
    }
  };
}

export function vaultDeslopHandler(config: Config) {
  return async ({ dryRun, confirm }: { dryRun?: boolean; confirm?: boolean }) => {
    try {
      const effectiveDryRun = dryRun ?? false;
      const report = await analyzeVaultSlop(config.vaultPath, config.maxFileSize);

      if (effectiveDryRun) {
        return ok(
          {
            wouldChange: report.wouldChange,
            summariesWouldChange: report.summariesWouldChange,
            filesToChange: report.filesToChange.map(summarizePlan),
            phraseFindings: report.phraseFindings.map(summarizeFinding),
            incomplete: report.incomplete,
            skipped: report.skipped,
            counts: {
              filesToChange: report.filesToChange.length,
              phraseFindings: report.phraseFindings.length,
              skipped: report.skipped.length,
            },
          },
          { action: 'deslop', changed: false },
        );
      }

      if (confirm !== true) {
        return invalidArgsError({
          tool: 'vault',
          action: 'deslop',
          message: 'deslop requires confirm: true (or dryRun: true to preview)',
          required: ['confirm'],
          missing: ['confirm'],
          rejected: [],
          arguments: { action: 'deslop', confirm: true },
        });
      }

      assertNotReadOnly(config.readOnly);

      if (!report.wouldChange) {
        return ok(
          {
            changedFiles: [],
            summariesChanged: false,
            indexSynced: false,
            phraseFindings: report.phraseFindings.map(summarizeFinding),
            incomplete: report.incomplete,
            skipped: report.skipped,
            counts: {
              changedFiles: 0,
              phraseFindings: report.phraseFindings.length,
              skipped: report.skipped.length,
            },
          },
          { action: 'deslop', changed: false, paths: [] },
        );
      }

      const plans = report.filesToChange;
      for (const plan of plans) {
        await assertSafePathAsync(config.vaultPath, plan.absolutePath);
      }

      let indexAbsolute: string | null = null;
      const summariesChanged = report.summariesWouldChange;
      if (summariesChanged) {
        indexAbsolute = resolvePath(config.vaultPath, INDEX_PATH);
        await assertSafePathAsync(config.vaultPath, indexAbsolute);
      }

      const lockPaths = plans.map((p) => p.absolutePath);
      const snapshotPaths = [...lockPaths];
      if (indexAbsolute) {
        lockPaths.push(indexAbsolute);
        snapshotPaths.push(indexAbsolute);
      }

      const journaled = await runJournaledMultiFileOperation(config, {
        tool: 'vault',
        action: 'deslop',
        lockPaths,
        snapshotPaths,
        run: async ({ tracker, recordAfter, readRevision }) => {
          const changedFiles: ReturnType<typeof summarizePlan>[] = [];

          for (const plan of plans) {
            await atomicReplaceLocked(
              config.vaultPath,
              plan.absolutePath,
              plan.cleaned,
              config.maxFileSize,
            );
            tracker.recordWrite(plan.relativePath);
            await recordAfter(plan.relativePath, await readRevision(plan.absolutePath));
            changedFiles.push(summarizePlan(plan));
          }

          let indexSynced = false;
          if (summariesChanged && indexAbsolute) {
            // Rebuild from disk after note writes so catalog matches cleaned summaries.
            const rebuilt = await buildIndexMarkdown(config.vaultPath, config.maxFileSize);
            let existingFm: Record<string, unknown> = { title: 'Wiki Index' };
            try {
              const raw = await readFileBounded(indexAbsolute, config.maxFileSize);
              existingFm = parseFrontmatter(raw).data;
            } catch {
              // create index.md
            }
            const frontmatter = withUpdatedTimestamp({ ...existingFm, title: 'Wiki Index' });
            const body = stringifyFrontmatter(frontmatter, rebuilt.markdown);
            await fs.mkdir(path.dirname(indexAbsolute), { recursive: true });
            await atomicReplaceLocked(config.vaultPath, indexAbsolute, body, config.maxFileSize);
            tracker.recordWrite(INDEX_PATH);
            await recordAfter(INDEX_PATH, await readRevision(indexAbsolute));
            indexSynced = true;
          }

          return {
            changedFiles,
            summariesChanged,
            indexSynced,
            phraseFindings: report.phraseFindings.map(summarizeFinding),
            incomplete: report.incomplete,
            skipped: report.skipped,
            counts: {
              changedFiles: changedFiles.length,
              phraseFindings: report.phraseFindings.length,
              skipped: report.skipped.length,
            },
          };
        },
      });

      clearAllSearchCaches();

      const changedPaths = journaled.value.changedFiles.map((f) => f.path);
      if (journaled.value.indexSynced) {
        changedPaths.push(INDEX_PATH);
      }

      return ok(journaled.value, {
        action: 'deslop',
        changed: true,
        paths: changedPaths,
        warnings: mergeJournaledWarnings(undefined, journaled),
        operationId: journaled.operationId,
        undoAvailable: journaled.undoAvailable,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'vault',
        action: 'deslop',
        arguments: { action: 'deslop', dryRun, confirm },
      });
    }
  };
}
