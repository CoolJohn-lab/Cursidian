import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toRelativePath } from './vault.js';
import { assertWritablePathAsync, readFileBounded } from './security.js';
import { computeRevisionHash } from './content-hash.js';
import { ensureTrashReady, pruneOperationJournals } from './backup.js';
import { TRASH_DIR_NAME } from './trash.js';
import { DEFAULT_BACKUP_RETENTION } from './limits.js';
import type { ToolName } from '../types/index.js';

export const JOURNAL_MANIFEST = 'manifest.json';
export const SNAPSHOTS_DIR = 'snapshots';

export const BACKUP_DISABLED_WARNING =
  'OBSIDIAN_BACKUP_ENABLED is false; this operation cannot be undone.';

export interface JournalEntryRecord {
  path: string;
  existedBefore: boolean;
  postWriteRevision: string | null;
  snapshotFile: string | null;
}

export interface OperationManifest {
  operationId: string;
  tool: ToolName;
  action: string;
  timestamp: string;
  undoAvailable: boolean;
  complete: boolean;
  entries: JournalEntryRecord[];
}

export interface OperationFinalizeResult {
  operationId: string;
  undoAvailable: boolean;
  warnings: string[];
}

export interface UndoConflict {
  path: string;
  expectedRevision: string | null;
  currentRevision: string | null;
}

export function encodeSnapshotName(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/\//g, '__');
}

function generateOperationId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${randomBytes(4).toString('hex')}`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function operationDir(vaultPath: string, operationId: string): string {
  return path.join(vaultPath, TRASH_DIR_NAME, operationId);
}

export class OperationJournal {
  private readonly operationId: string;
  private readonly opDir: string | null;
  private readonly entries: JournalEntryRecord[] = [];
  private finalized = false;

  private constructor(
    private readonly vaultPath: string,
    private readonly backupEnabled: boolean,
    private readonly tool: ToolName,
    private readonly action: string,
    operationId: string,
    opDir: string | null,
  ) {
    this.operationId = operationId;
    this.opDir = opDir;
  }

  static async begin(
    vaultPath: string,
    options: { backupEnabled: boolean; tool: ToolName; action: string },
  ): Promise<OperationJournal> {
    const operationId = generateOperationId();
    if (!options.backupEnabled) {
      return new OperationJournal(
        vaultPath,
        false,
        options.tool,
        options.action,
        operationId,
        null,
      );
    }

    await ensureTrashReady(vaultPath);
    const opDir = operationDir(vaultPath, operationId);
    await assertWritablePathAsync(vaultPath, opDir);
    await fs.mkdir(path.join(opDir, SNAPSHOTS_DIR), { recursive: true });
    return new OperationJournal(
      vaultPath,
      true,
      options.tool,
      options.action,
      operationId,
      opDir,
    );
  }

  async recordBefore(absolutePath: string, _maxFileSize: number): Promise<void> {
    const relative = toRelativePath(this.vaultPath, absolutePath).replace(/\\/g, '/');
    if (!(await pathExists(absolutePath))) {
      this.entries.push({
        path: relative,
        existedBefore: false,
        postWriteRevision: null,
        snapshotFile: null,
      });
      return;
    }

    let snapshotFile: string | null = null;
    if (this.opDir) {
      const snapshotRel = path.posix.join(SNAPSHOTS_DIR, encodeSnapshotName(relative));
      const snapshotAbs = path.join(this.opDir, snapshotRel);
      await assertWritablePathAsync(this.vaultPath, snapshotAbs);
      await fs.copyFile(absolutePath, snapshotAbs);
      snapshotFile = snapshotRel;
    }

    this.entries.push({
      path: relative,
      existedBefore: true,
      postWriteRevision: null,
      snapshotFile,
    });
  }

  recordNewFile(relativePath: string): void {
    const normalized = relativePath.replace(/\\/g, '/');
    this.entries.push({
      path: normalized,
      existedBefore: false,
      postWriteRevision: null,
      snapshotFile: null,
    });
  }

  recordAfter(relativePath: string, postWriteRevision: string | null): void {
    const normalized = relativePath.replace(/\\/g, '/');
    const entry = this.entries.find((item) => item.path === normalized);
    if (!entry) {
      throw new Error(`Journal entry not found for path: ${normalized}`);
    }
    entry.postWriteRevision = postWriteRevision;
  }

  async finalize(): Promise<OperationFinalizeResult> {
    if (this.finalized) {
      throw new Error('Operation journal already finalized');
    }
    this.finalized = true;

    if (!this.backupEnabled || !this.opDir) {
      return {
        operationId: this.operationId,
        undoAvailable: false,
        warnings: [BACKUP_DISABLED_WARNING],
      };
    }

    const manifest: OperationManifest = {
      operationId: this.operationId,
      tool: this.tool,
      action: this.action,
      timestamp: new Date().toISOString(),
      undoAvailable: true,
      complete: true,
      entries: this.entries,
    };

    await fs.writeFile(
      path.join(this.opDir, JOURNAL_MANIFEST),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
    await pruneOperationJournals(this.vaultPath, DEFAULT_BACKUP_RETENTION);

    return {
      operationId: this.operationId,
      undoAvailable: true,
      warnings: [],
    };
  }

  async abort(): Promise<void> {
    if (this.finalized || !this.opDir) {
      return;
    }
    await fs.rm(this.opDir, { recursive: true, force: true });
  }
}

export async function readOperationManifest(
  vaultPath: string,
  operationId: string,
): Promise<OperationManifest | null> {
  const manifestPath = path.join(operationDir(vaultPath, operationId), JOURNAL_MANIFEST);
  if (!(await pathExists(manifestPath))) {
    return null;
  }
  const raw = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as OperationManifest;
}

export async function listOperationHistory(
  vaultPath: string,
  limit = 50,
): Promise<OperationManifest[]> {
  const trashRoot = path.join(vaultPath, TRASH_DIR_NAME);
  if (!(await pathExists(trashRoot))) {
    return [];
  }

  const entries = await fs.readdir(trashRoot, { withFileTypes: true });
  const manifests: OperationManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_legacy')) {
      continue;
    }
    const manifest = await readOperationManifest(vaultPath, entry.name);
    if (manifest?.complete) {
      manifests.push(manifest);
    }
  }

  return manifests
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

async function readCurrentRevision(
  vaultPath: string,
  relativePath: string,
  maxFileSize: number,
): Promise<string | null> {
  const absolute = path.join(vaultPath, relativePath);
  if (!(await pathExists(absolute))) {
    return null;
  }
  const raw = await readFileBounded(absolute, maxFileSize);
  return computeRevisionHash(raw);
}

export async function collectUndoConflicts(
  vaultPath: string,
  manifest: OperationManifest,
  maxFileSize: number,
): Promise<UndoConflict[]> {
  const conflicts: UndoConflict[] = [];

  for (const entry of manifest.entries) {
    const currentRevision = await readCurrentRevision(vaultPath, entry.path, maxFileSize);
    if (entry.postWriteRevision === null) {
      if (currentRevision !== null) {
        conflicts.push({
          path: entry.path,
          expectedRevision: null,
          currentRevision,
        });
      }
      continue;
    }

    if (currentRevision !== entry.postWriteRevision) {
      conflicts.push({
        path: entry.path,
        expectedRevision: entry.postWriteRevision,
        currentRevision,
      });
    }
  }

  return conflicts;
}

export function snapshotAbsolutePath(
  vaultPath: string,
  operationId: string,
  snapshotFile: string,
): string {
  return path.join(operationDir(vaultPath, operationId), snapshotFile);
}

export function mergeOperationWarnings(
  existing: string[] | undefined,
  journal: OperationFinalizeResult,
): string[] | undefined {
  const merged = [...(existing ?? []), ...journal.warnings];
  return merged.length > 0 ? merged : undefined;
}
