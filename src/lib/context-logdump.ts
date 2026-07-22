import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import {
  buildContextQualitySnapshot,
  type ContextAssembleDiagnostics,
  type ContextQualitySnapshot,
} from './context-quality.js';
import type { ContextBundle } from '../types/index.js';

const LOGDUMP_ENV = 'OBSIDIAN_CONTEXT_LOGDUMP';
const LOGDUMP_DIR_ENV = 'OBSIDIAN_CONTEXT_LOGDUMP_DIR';

/** Bump when ContextSearches JSONL record shape changes. */
export const CONTEXT_LOGDUMP_SCHEMA_VERSION = 2;

const require = createRequire(import.meta.url);

function readPackageVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

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
  schemaVersion: number;
  packageVersion: string;
  callId: string;
  timestamp: string;
  /** Wall-clock only - quality analysis should ignore this. */
  latencyMs: number;
  status: ContextLogdumpStatus;
  input: Record<string, unknown>;
  output: unknown;
  /** Present on successful assemble/for_task/expand when output is a ContextBundle. */
  quality?: ContextQualitySnapshot;
  /** Ranking/selection diagnostics for accuracy drill-down (logdump only). */
  ranking?: ContextAssembleDiagnostics;
}

function dailyLogPath(dir: string, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return path.join(dir, `${yyyy}-${mm}-${dd}.jsonl`);
}

function isContextBundle(output: unknown): output is ContextBundle {
  return (
    typeof output === 'object' &&
    output !== null &&
    'tokensUsed' in output &&
    'tokenBudget' in output &&
    'items' in output &&
    Array.isArray((output as ContextBundle).items)
  );
}

/**
 * Append one ContextSearches JSONL record for a `context` MCP call.
 * Best-effort: never throws to the caller; dump failures must not break the tool.
 *
 * schemaVersion 2 adds callId, packageVersion, precomputed `quality`, and optional
 * `ranking` (search hits / reranked candidates / compact items without passage text).
 */
export async function recordContextLogdump(entry: {
  latencyMs: number;
  status: ContextLogdumpStatus;
  input: Record<string, unknown>;
  output: unknown;
  ranking?: ContextAssembleDiagnostics;
  env?: NodeJS.ProcessEnv;
}): Promise<{ written: boolean; path?: string }> {
  const dir = resolveContextLogdumpDir(entry.env ?? process.env);
  if (!dir) {
    return { written: false };
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    const target = dailyLogPath(dir);
    const record: ContextLogdumpEntry = {
      schemaVersion: CONTEXT_LOGDUMP_SCHEMA_VERSION,
      packageVersion: readPackageVersion(),
      callId: randomUUID(),
      timestamp: new Date().toISOString(),
      latencyMs: entry.latencyMs,
      status: entry.status,
      input: entry.input,
      output: entry.output,
    };
    if (entry.status === 'success' && isContextBundle(entry.output)) {
      record.quality = buildContextQualitySnapshot(entry.output);
    }
    if (entry.ranking) {
      record.ranking = entry.ranking;
    }
    await fs.appendFile(target, `${JSON.stringify(record)}\n`, 'utf-8');
    return { written: true, path: target };
  } catch (e) {
    logger.debug('Context logdump write failed', {
      message: e instanceof Error ? e.message : String(e),
    });
    return { written: false };
  }
}
