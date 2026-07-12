import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  OperationJournal,
  encodeSnapshotName,
  listOperationHistory,
  readOperationManifest,
  collectUndoConflicts,
  JOURNAL_MANIFEST,
  SNAPSHOTS_DIR,
} from '../../src/lib/operation-journal.js';
import { TRASH_DIR_NAME } from '../../src/lib/trash.js';
import { DEFAULT_BACKUP_RETENTION } from '../../src/lib/limits.js';
import { resetLegacyMigrationCache } from '../../src/lib/backup.js';

describe('operation-journal', () => {
  let vault = '';

  beforeAll(async () => {
    resetLegacyMigrationCache();
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-journal-'));
  });

  afterAll(async () => {
    await fsp.rm(vault, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const trash = path.join(vault, TRASH_DIR_NAME);
    await fsp.rm(trash, { recursive: true, force: true }).catch(() => undefined);
  });

  it('encodeSnapshotName normalizes path separators', () => {
    expect(encodeSnapshotName('Concepts/foo.md')).toBe('Concepts__foo.md');
  });

  it('finalizes a complete journal with snapshot and manifest', async () => {
    const notePath = path.join(vault, 'note.md');
    await fsp.writeFile(notePath, '# before\n', 'utf-8');

    const journal = await OperationJournal.begin(vault, {
      backupEnabled: true,
      tool: 'note',
      action: 'update',
    });
    await journal.recordBefore(notePath, 1024);
    await journal.recordAfter('note.md', 'post-revision-hash');
    const result = await journal.finalize();

    expect(result.undoAvailable).toBe(true);
    expect(result.operationId).toBeTruthy();

    const manifest = await readOperationManifest(vault, result.operationId);
    expect(manifest?.complete).toBe(true);
    expect(manifest?.entries).toHaveLength(1);
    expect(manifest?.entries[0].existedBefore).toBe(true);
    expect(manifest?.entries[0].snapshotFile).toContain(SNAPSHOTS_DIR);
  });

  it('returns undoAvailable false when backups are disabled', async () => {
    const journal = await OperationJournal.begin(vault, {
      backupEnabled: false,
      tool: 'note',
      action: 'create',
    });
    journal.recordNewFile('new.md');
    await journal.recordAfter('new.md', 'hash');
    const result = await journal.finalize();

    expect(result.undoAvailable).toBe(false);
    expect(result.warnings[0]).toContain('OBSIDIAN_BACKUP_ENABLED');
    const trashExists = await fsp
      .access(path.join(vault, TRASH_DIR_NAME, result.operationId))
      .then(() => true)
      .catch(() => false);
    expect(trashExists).toBe(false);
  });

  it('aborts incomplete journal folders', async () => {
    const journal = await OperationJournal.begin(vault, {
      backupEnabled: true,
      tool: 'note',
      action: 'update',
    });
    const operationId = (journal as unknown as { operationId: string }).operationId;
    await journal.abort();

    const opDir = path.join(vault, TRASH_DIR_NAME, operationId);
    const exists = await fsp.access(opDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('lists only complete operations in history', async () => {
    const complete = await OperationJournal.begin(vault, {
      backupEnabled: true,
      tool: 'note',
      action: 'create',
    });
    complete.recordNewFile('a.md');
    await complete.recordAfter('a.md', 'hash-a');
    const completeResult = await complete.finalize();

    const incompleteDir = path.join(vault, TRASH_DIR_NAME, 'incomplete-op');
    await fsp.mkdir(incompleteDir, { recursive: true });
    await fsp.writeFile(
      path.join(incompleteDir, JOURNAL_MANIFEST),
      JSON.stringify({
        operationId: 'incomplete-op',
        tool: 'note',
        action: 'create',
        timestamp: new Date().toISOString(),
        undoAvailable: true,
        complete: false,
        entries: [],
      }),
      'utf-8',
    );

    const history = await listOperationHistory(vault, 10);
    expect(history.some((item) => item.operationId === completeResult.operationId)).toBe(true);
    expect(history.some((item) => item.operationId === 'incomplete-op')).toBe(false);
  });

  it('collects undo conflicts when current revision differs', async () => {
    const notePath = path.join(vault, 'conflict.md');
    await fsp.writeFile(notePath, '# original\n', 'utf-8');

    const journal = await OperationJournal.begin(vault, {
      backupEnabled: true,
      tool: 'note',
      action: 'update',
    });
    await journal.recordBefore(notePath, 1024);
    await journal.recordAfter('conflict.md', 'expected-revision');
    const op = await journal.finalize();
    const manifest = await readOperationManifest(vault, op.operationId);
    expect(manifest).toBeTruthy();

    const conflicts = await collectUndoConflicts(vault, manifest as NonNullable<typeof manifest>, 1024);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('conflict.md');
  });

  it('prunes oldest operation journals beyond retention', async () => {
    const trashRoot = path.join(vault, TRASH_DIR_NAME);
    await fsp.mkdir(trashRoot, { recursive: true });

    for (let i = 0; i < DEFAULT_BACKUP_RETENTION + 2; i++) {
      const id = `2020-01-01T00-00-00-${String(i).padStart(3, '0')}-abcd`;
      const opDir = path.join(trashRoot, id);
      await fsp.mkdir(opDir, { recursive: true });
      await fsp.writeFile(
        path.join(opDir, JOURNAL_MANIFEST),
        JSON.stringify({
          operationId: id,
          tool: 'note',
          action: 'create',
          timestamp: `2020-01-01T00:00:00.${String(i).padStart(3, '0')}Z`,
          undoAvailable: true,
          complete: true,
          entries: [],
        }),
        'utf-8',
      );
    }

    const journal = await OperationJournal.begin(vault, {
      backupEnabled: true,
      tool: 'note',
      action: 'create',
    });
    journal.recordNewFile('prune.md');
    await journal.recordAfter('prune.md', 'hash');
    await journal.finalize();

    const remaining = await fsp.readdir(trashRoot);
    const opFolders = remaining.filter((name) => !name.startsWith('_legacy'));
    expect(opFolders.length).toBeLessThanOrEqual(DEFAULT_BACKUP_RETENTION);
  });
});
