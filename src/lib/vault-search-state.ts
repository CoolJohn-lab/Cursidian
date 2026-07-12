import path from 'node:path';
import { getVaultSnapshot, type VaultMarkdownFile } from './vault-snapshot.js';

export type { VaultMarkdownFile };

/**
 * Clears cached vault markdown snapshots (used in tests and after vault writes).
 */
export function clearVaultSearchStateCache(): void {
  // Unified snapshot cache is cleared via clearAllSearchCaches -> clearVaultSnapshotCache.
}

/**
 * Loads all vault markdown bodies once per TTL window via the unified snapshot.
 */
export async function getVaultMarkdownFiles(
  vaultPath: string,
  maxFileSize: number,
): Promise<VaultMarkdownFile[]> {
  const snapshot = await getVaultSnapshot(vaultPath, maxFileSize);
  return snapshot.files;
}

/**
 * Returns vault-relative paths from the latest snapshot listing.
 */
export async function getVaultMarkdownRelativePaths(vaultPath: string): Promise<string[]> {
  const snapshot = await getVaultSnapshot(vaultPath, Number.MAX_SAFE_INTEGER);
  return snapshot.files.map((f) => f.relativePath);
}

export function relativePathFromAbsolute(vaultPath: string, absolute: string): string {
  return path.relative(vaultPath, absolute).split(path.sep).join('/');
}
