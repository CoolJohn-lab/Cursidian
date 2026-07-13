import fs from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

/** Updates the minimum level that will be emitted. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Formats one log line. Kept pure so tests can assert on content without I/O.
 */
export function formatLogLine(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
  timestamp: string = new Date().toISOString(),
): string {
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

/**
 * Writes a log line to the right sink for stdio MCP.
 * stdout is reserved for JSON-RPC - never use it for logs.
 * Cursor labels all stderr as [error], so INFO/DEBUG avoid stderr unless
 * OBSIDIAN_LOG_FILE is set (append) or OBSIDIAN_LOG_STDERR_INFO=true.
 */
function writeLogLine(level: LogLevel, line: string): void {
  if (level === 'error' || level === 'warn') {
    // Surface real problems on stderr for the host and operators.
    process.stderr.write(`${line}\n`);
    return;
  }

  const logFile = process.env.OBSIDIAN_LOG_FILE?.trim();
  if (logFile) {
    // Optional file sink keeps verbose ops logs without polluting Cursor MCP logs.
    fs.appendFileSync(logFile, `${line}\n`);
    return;
  }

  if (process.env.OBSIDIAN_LOG_STDERR_INFO === 'true') {
    // Explicit opt-in for local debugging when a log file is not configured.
    process.stderr.write(`${line}\n`);
  }
}

/** Emits a leveled log line if it meets the current threshold. */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  // Build then route so sinks stay consistent across call sites.
  const line = formatLogLine(level, message, meta);
  writeLogLine(level, line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
