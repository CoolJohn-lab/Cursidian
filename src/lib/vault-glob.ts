import path from 'node:path';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import { TRASH_GLOB_IGNORE } from './trash.js';

const realVaultCache = new Map<string, string>();

/**
 * Clears cached realpath for vault roots (tests).
 */
export function clearRealVaultCache(): void {
  realVaultCache.clear();
}

async function getRealVault(vaultPath: string): Promise<string> {
  let cached = realVaultCache.get(vaultPath);
  if (!cached) {
    cached = await fs.realpath(vaultPath);
    realVaultCache.set(vaultPath, cached);
  }
  return cached;
}

/**
 * Returns true when absolutePath resolves to a location inside the vault.
 */
export async function isPathInsideVault(vaultPath: string, absolutePath: string): Promise<boolean> {
  const realVault = await getRealVault(vaultPath);
  try {
    const realPath = await fs.realpath(absolutePath);
    const relative = path.relative(realVault, realPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

export interface VaultGlobOptions {
  cwd?: string;
  onlyDirectories?: boolean;
  ignore?: string[];
}

/**
 * Lists paths under a vault with symlink following disabled and post-filters
 * any result whose real path escapes the vault boundary.
 */
export async function vaultGlob(
  vaultPath: string,
  pattern: string,
  options: VaultGlobOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? vaultPath;
  const raw = await fg(pattern, {
    cwd,
    absolute: true,
    dot: false,
    onlyDirectories: options.onlyDirectories,
    followSymbolicLinks: false,
    ignore: options.ignore ?? [TRASH_GLOB_IGNORE],
  });

  const safe: string[] = [];
  for (const absolute of raw) {
    if (await isPathInsideVault(vaultPath, absolute)) {
      safe.push(absolute);
    }
  }
  return safe;
}

/**
 * All vault-relative markdown paths as absolute paths inside the vault.
 */
export async function listVaultMarkdownPaths(vaultPath: string): Promise<string[]> {
  return vaultGlob(vaultPath, '**/*.md');
}
