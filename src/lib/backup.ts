import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { LEGACY_TRASH_DIR_NAME, TRASH_DIR_NAME } from './trash.js';

export { TRASH_DIR_NAME, LEGACY_TRASH_DIR_NAME };

/**
 * Deletes the legacy trash directory if present, then returns the active trash dir name.
 */
async function removeLegacyTrash(vaultPath: string): Promise<void> {
  const legacy = path.join(vaultPath, LEGACY_TRASH_DIR_NAME);
  try {
    await fs.rm(legacy, { recursive: true, force: true });
  } catch {
    // ignore - force:true should not throw for missing paths
  }
}

export async function backupNote(vaultPath: string, notePath: string): Promise<string> {
  await removeLegacyTrash(vaultPath);

  const relativePath = path.relative(vaultPath, notePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(vaultPath, TRASH_DIR_NAME, timestamp, path.dirname(relativePath));

  await fs.mkdir(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, path.basename(notePath));
  await fs.copyFile(notePath, backupPath);

  logger.info('Backup created', { original: relativePath, backup: backupPath });
  return backupPath;
}
