import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { backupNote, resetLegacyMigrationCache } from '../../src/lib/backup.js';
import { LEGACY_TRASH_DIR_NAME, TRASH_DIR_NAME } from '../../src/lib/trash.js';

let vault: string;
let noteFile: string;

beforeAll(async () => {
  resetLegacyMigrationCache();
  vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-test-backup-'));
  noteFile = path.join(vault, 'note.md');
  await fsp.writeFile(noteFile, '# Original content');
});

afterAll(async () => {
  await fsp.rm(vault, { recursive: true, force: true });
});

describe('backupNote', () => {
  it('creates a backup file in the trash directory', async () => {
    const backupPath = await backupNote(vault, noteFile);
    const exists = await fsp.access(backupPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('backup contains the original content', async () => {
    const backupPath = await backupNote(vault, noteFile);
    const content = await fsp.readFile(backupPath, 'utf-8');
    expect(content).toBe('# Original content');
  });

  it('backup path is inside .cursidian-trash', async () => {
    const backupPath = await backupNote(vault, noteFile);
    expect(backupPath).toContain(TRASH_DIR_NAME);
  });

  it('migrates legacy .obsidian-mcp-trash into active trash on backup', async () => {
    resetLegacyMigrationCache();
    const isolated = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-legacy-'));
    const isolatedNote = path.join(isolated, 'note.md');
    await fsp.writeFile(isolatedNote, '# isolated');
    const legacy = path.join(isolated, LEGACY_TRASH_DIR_NAME, 'old.md');
    await fsp.mkdir(path.dirname(legacy), { recursive: true });
    await fsp.writeFile(legacy, 'legacy');

    await backupNote(isolated, isolatedNote);

    const legacyStillExists = await fsp
      .access(legacy)
      .then(() => true)
      .catch(() => false);
    expect(legacyStillExists).toBe(false);

    const migrated = path.join(isolated, TRASH_DIR_NAME, '_legacy-migrated', 'old.md');
    const migratedExists = await fsp.access(migrated).then(() => true).catch(() => false);
    expect(migratedExists).toBe(true);

    await fsp.rm(isolated, { recursive: true, force: true });
  });
});
