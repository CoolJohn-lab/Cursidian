import { z } from 'zod/v3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setLogLevel, type LogLevel } from './lib/logger.js';

const DEFAULT_MAX_FILE_SIZE = 10_485_760;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `OBSIDIAN_MAX_FILE_SIZE must be a positive integer (got "${raw}"). Example: 10485760`,
    );
  }
  return parsed;
}

/**
 * Parses a boolean env var with a consistent default when unset/blank.
 */
function boolEnvVar(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error(`Expected boolean env value (true/false), got "${raw}"`);
}

const configSchema = z.object({
  OBSIDIAN_VAULT_PATH: z.string().min(1),
  OBSIDIAN_READ_ONLY: z.string().optional(),
  OBSIDIAN_MAX_FILE_SIZE: z.string().optional(),
  OBSIDIAN_BACKUP_ENABLED: z.string().optional(),
  OBSIDIAN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
});

export interface Config {
  vaultPath: string;
  readOnly: boolean;
  maxFileSize: number;
  backupEnabled: boolean;
  logLevel: LogLevel;
}

export function resolveVaultPath(raw: string): string {
  let expanded = raw.trim();
  let homeRelative = false;

  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
    homeRelative = true;
  } else if (expanded === '~') {
    expanded = os.homedir();
    homeRelative = true;
  }

  if (process.platform === 'win32' && /^%USERPROFILE%/i.test(expanded)) {
    expanded = path.join(
      os.homedir(),
      expanded.replace(/^%USERPROFILE%/i, '').replace(/^[/\\]/, ''),
    );
    homeRelative = true;
  }

  if (!path.isAbsolute(expanded)) {
    throw new Error('Vault path must be absolute after ~ / %USERPROFILE% expansion');
  }

  const resolved = path.resolve(expanded);
  if (homeRelative) {
    const home = path.resolve(os.homedir());
    const relative = path.relative(home, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Vault path escapes the home directory after ~ / %USERPROFILE% expansion');
    }
  }
  return resolved;
}

function printVaultPathExamples(): void {
  console.error('Example (Unix): OBSIDIAN_VAULT_PATH=/Users/you/MyVault');
  console.error('Example (Windows): OBSIDIAN_VAULT_PATH=C:\\Users\\you\\MyVault');
}

export async function loadConfig(): Promise<Config> {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('[FATAL] Invalid configuration:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    console.error('OBSIDIAN_VAULT_PATH must be set to the absolute path of your Obsidian vault.');
    printVaultPathExamples();
    process.exit(1);
  }

  const env = result.data;

  let vaultPath: string;
  try {
    vaultPath = resolveVaultPath(env.OBSIDIAN_VAULT_PATH);
  } catch (err) {
    console.error(
      `[FATAL] ${err instanceof Error ? err.message : 'OBSIDIAN_VAULT_PATH is invalid.'}`,
    );
    printVaultPathExamples();
    process.exit(1);
  }

  let maxFileSize: number;
  try {
    maxFileSize = parsePositiveInt(env.OBSIDIAN_MAX_FILE_SIZE, DEFAULT_MAX_FILE_SIZE);
  } catch (err) {
    console.error(`[FATAL] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let readOnly: boolean;
  let backupEnabled: boolean;
  try {
    readOnly = boolEnvVar(env.OBSIDIAN_READ_ONLY, false);
    backupEnabled = boolEnvVar(env.OBSIDIAN_BACKUP_ENABLED, true);
  } catch (err) {
    console.error(`[FATAL] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let realVault: string;
  try {
    realVault = await fs.realpath(vaultPath);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code === 'ENOENT') {
      console.error(`[FATAL] Vault path does not exist: ${vaultPath}`);
    } else {
      console.error(
        `[FATAL] Cannot access vault path ${vaultPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(1);
  }

  const stat = await fs.stat(realVault);
  if (!stat.isDirectory()) {
    console.error(`[FATAL] Vault path is not a directory: ${vaultPath}`);
    process.exit(1);
  }

  vaultPath = realVault;

  try {
    await fs.access(path.join(vaultPath, '.obsidian'));
  } catch {
    try {
      await fs.access(path.join(vaultPath, 'index.md'));
    } catch {
      console.error(
        `[WARN] Vault has neither .obsidian/ nor index.md - continuing anyway (plain markdown folders are supported): ${vaultPath}`,
      );
    }
  }

  const config: Config = {
    vaultPath,
    readOnly,
    maxFileSize,
    backupEnabled,
    logLevel: env.OBSIDIAN_LOG_LEVEL as LogLevel,
  };

  setLogLevel(config.logLevel);
  return config;
}

export { parsePositiveInt, DEFAULT_MAX_FILE_SIZE, boolEnvVar };
