import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger.js';

const LOGDUMP_ENV = 'OBSIDIAN_CONTEXT_LOGDUMP';
const LOGDUMP_DIR_ENV = 'OBSIDIAN_CONTEXT_LOGDUMP_DIR';

/** Default: ~/.cursor/logdump/ContextSearches (cursor-global experiment dumps). */
export function defaultContextLogdumpDir(): string {
  return path.join(os.homedir(), '.cursor', 'logdump', 'ContextSearches');
}

/**
 * Resolve the ContextSearches dump directory.
 * - `OBSIDIAN_CONTEXT_LOGDUMP=false|0|off` -> disabled (null)
 * - `OBSIDIAN_CONTEXT_LOGDUMP_DIR` -> override path
 * - else -> ~/.cursor/logdump/ContextSearches
 */
export function resolveContextLogdumpDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const flag = env[LOGDUMP_ENV]?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') {
    return null;
  }
  const override = env[LOGDUMP_DIR_ENV]?.trim();
  if (override) {
    return path.resolve(override);
  }
  return defaultContextLogdumpDir();
}

export type ContextLogdumpStatus = 'success' | 'error';

export interface ContextLogdumpEntry {
  timestamp: string;
  latencyMs: number;
  status: ContextLogdumpStatus;
  input: Record<string, unknown>;
  output: unknown;
}

function dailyLogPath(dir: string, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return path.join(dir, `${yyyy}-${mm}-${dd}.jsonl`);
}

/**
 * Append one full input/output record for a `context` MCP call.
 * Best-effort: never throws to the caller; dump failures must not break the tool.
 */
export async function recordContextLogdump(entry: {
  latencyMs: number;
  status: ContextLogdumpStatus;
  input: Record<string, unknown>;
  output: unknown;
  env?: NodeJS.ProcessEnv;
}): Promise<{ written: boolean; path?: string }> {
  const dir = resolveContextLogdumpDir(entry.env ?? process.env);
  if (!dir) {
    return { written: false };
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    const target = dailyLogPath(dir);
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      latencyMs: entry.latencyMs,
      status: entry.status,
      input: entry.input,
      output: entry.output,
    } satisfies ContextLogdumpEntry);
    await fs.appendFile(target, `${line}\n`, 'utf-8');
    return { written: true, path: target };
  } catch (e) {
    logger.debug('Context logdump write failed', {
      message: e instanceof Error ? e.message : String(e),
    });
    return { written: false };
  }
}
