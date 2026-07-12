import { z } from 'zod/v3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setLogLevel, type LogLevel } from './lib/logger.js';

const configSchema = z.object({
  OBSIDIAN_VAULT_PATH: z.string().min(1),
  OBSIDIAN_READ_ONLY: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  OBSIDIAN_MAX_FILE_SIZE: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10_485_760)),
  OBSIDIAN_BACKUP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  OBSIDIAN_LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .optional()
    .default('info'),
});

export interface Config {
  vaultPath: string;
  readOnly: boolean;
  maxFileSize: number;
  backupEnabled: boolean;
  logLevel: LogLevel;
}

/**
 * Expands ~ / %USERPROFILE% and requires an absolute vault path.
 */
export function resolveVaultPath(raw: string): string {
  let expanded = raw.trim();

  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  } else if (expanded === '~') {
    expanded = os.homedir();
  }

  if (process.platform === 'win32' && /^%USERPROFILE%/i.test(expanded)) {
    expanded = path.join(os.homedir(), expanded.replace(/^%USERPROFILE%/i, '').replace(/^[/\\]/, ''));
  }

  if (!path.isAbsolute(expanded)) {
    throw new Error('Vault path must be absolute after ~ / %USERPROFILE% expansion');
  }
  return path.resolve(expanded);
}

function printVaultPathExamples(): void {
  console.error('Example (Unix): OBSIDIAN_VAULT_PATH=/Users/you/MyVault');
  console.error('Example (Windows): OBSIDIAN_VAULT_PATH=C:\\Users\\you\\MyVault');
}

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('[FATAL] Missing required environment variable: OBSIDIAN_VAULT_PATH');
    console.error('Set it to the absolute path of your Obsidian vault.');
    printVaultPathExamples();
    process.exit(1);
  }

  const env = result.data as Required<NonNullable<typeof result.data>>;

  let vaultPath: string;
  try {
    vaultPath = resolveVaultPath(env.OBSIDIAN_VAULT_PATH);
  } catch {
    console.error('[FATAL] OBSIDIAN_VAULT_PATH must be an absolute path (relative paths are not allowed).');
    printVaultPathExamples();
    process.exit(1);
  }

  if (!fs.existsSync(vaultPath)) {
    console.error(`[FATAL] Vault path does not exist: ${vaultPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(vaultPath);
  if (!stat.isDirectory()) {
    console.error(`[FATAL] Vault path is not a directory: ${vaultPath}`);
    process.exit(1);
  }

  const hasObsidian = fs.existsSync(path.join(vaultPath, '.obsidian'));
  const hasIndex = fs.existsSync(path.join(vaultPath, 'index.md'));
  if (!hasObsidian && !hasIndex) {
    console.error(
      `[WARN] Vault has neither .obsidian/ nor index.md - continuing anyway (plain markdown folders are supported): ${vaultPath}`,
    );
  }

  const config: Config = {
    vaultPath,
    readOnly: env.OBSIDIAN_READ_ONLY,
    maxFileSize: env.OBSIDIAN_MAX_FILE_SIZE,
    backupEnabled: env.OBSIDIAN_BACKUP_ENABLED,
    logLevel: env.OBSIDIAN_LOG_LEVEL as LogLevel,
  };

  setLogLevel(config.logLevel);
  return config;
}
