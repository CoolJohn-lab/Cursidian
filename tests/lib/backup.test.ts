import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { backupNote } from '../../src/lib/backup.js';
import { LEGACY_TRASH_DIR_NAME, TRASH_DIR_NAME } from '../../src/lib/trash.js';

let vault: string;
let noteFile: string;

beforeAll(async () => {
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

  it('deletes legacy .obsidian-mcp-trash on backup', async () => {
    const legacy = path.join(vault, LEGACY_TRASH_DIR_NAME, 'old.md');
    await fsp.mkdir(path.dirname(legacy), { recursive: true });
    await fsp.writeFile(legacy, 'legacy');

    const backupPath = await backupNote(vault, noteFile);
    expect(backupPath).toContain(TRASH_DIR_NAME);

    const legacyExists = await fsp
      .access(path.join(vault, LEGACY_TRASH_DIR_NAME))
      .then(() => true)
      .catch(() => false);
    expect(legacyExists).toBe(false);
  });
});
