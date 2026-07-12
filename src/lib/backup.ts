import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { LEGACY_TRASH_DIR_NAME, TRASH_DIR_NAME } from './trash.js';
import { assertWritablePathAsync } from './security.js';
import { DEFAULT_BACKUP_RETENTION } from './limits.js';

export { TRASH_DIR_NAME, LEGACY_TRASH_DIR_NAME };

let legacyMigrationDone = new Set<string>();

/**
 * Resets legacy migration tracking (tests).
 */
export function resetLegacyMigrationCache(): void {
  legacyMigrationDone = new Set();
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves legacy trash entries into the active trash directory once per vault.
 */
async function migrateLegacyTrash(vaultPath: string): Promise<void> {
  if (legacyMigrationDone.has(vaultPath)) {
    return;
  }
  legacyMigrationDone.add(vaultPath);

  const legacy = path.join(vaultPath, LEGACY_TRASH_DIR_NAME);
  if (!(await pathExists(legacy))) {
    return;
  }

  const activeRoot = path.join(vaultPath, TRASH_DIR_NAME);
  await fs.mkdir(activeRoot, { recursive: true });
  const migrated = path.join(activeRoot, '_legacy-migrated');
  await fs.mkdir(migrated, { recursive: true });

  const entries = await fs.readdir(legacy, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(legacy, entry.name);
    const to = path.join(migrated, entry.name);
    if (!(await pathExists(to))) {
      await fs.rename(from, to);
    }
  }

  const remaining = await fs.readdir(legacy);
  if (remaining.length === 0) {
    await fs.rm(legacy, { recursive: true, force: true });
  }
}

/**
 * Prunes oldest backup session folders beyond retention.
 */
async function pruneOldBackups(vaultPath: string, retention = DEFAULT_BACKUP_RETENTION): Promise<void> {
  const trashRoot = path.join(vaultPath, TRASH_DIR_NAME);
  if (!(await pathExists(trashRoot))) {
    return;
  }

  const entries = await fs.readdir(trashRoot, { withFileTypes: true });
  const sessions = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_legacy'))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a));

  for (const old of sessions.slice(retention)) {
    await fs.rm(path.join(trashRoot, old), { recursive: true, force: true });
  }
}

/**
 * Prunes oldest backup session folders beyond retention.
 */
export async function pruneOperationJournals(
  vaultPath: string,
  retention = DEFAULT_BACKUP_RETENTION,
): Promise<void> {
  await pruneOldBackups(vaultPath, retention);
}

/**
 * Ensures trash is ready (legacy migration) before journal or backup writes.
 */
export async function ensureTrashReady(vaultPath: string): Promise<void> {
  await migrateLegacyTrash(vaultPath);
}

export async function backupNote(vaultPath: string, notePath: string): Promise<string> {
  await assertWritablePathAsync(vaultPath, notePath);
  await ensureTrashReady(vaultPath);

  const relativePath = path.relative(vaultPath, notePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(vaultPath, TRASH_DIR_NAME, timestamp, path.dirname(relativePath));

  await assertWritablePathAsync(vaultPath, backupDir);
  await fs.mkdir(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, path.basename(notePath));
  await assertWritablePathAsync(vaultPath, backupPath);
  await fs.copyFile(notePath, backupPath);

  await pruneOldBackups(vaultPath);

  logger.info('Backup created', { original: relativePath, backup: backupPath });
  return backupPath;
}

/**
 * Backs up an existing note when present; no-op when the file does not exist.
 */
export async function backupNoteIfExists(vaultPath: string, notePath: string): Promise<string | undefined> {
  if (!(await pathExists(notePath))) {
    return undefined;
  }
  return backupNote(vaultPath, notePath);
}
