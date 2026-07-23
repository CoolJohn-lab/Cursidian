import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_LOG_LINE_BYTES = 8 * 1024;

let currentLevel: LogLevel = 'info';
let logFileStream: fs.WriteStream | null = null;
let validatedLogFile: string | null | undefined;

/** Updates the minimum level that will be emitted. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Strip CR/LF and C0 control chars (incl. ANSI ESC) so nothing can forge a log line.
 */
export function scrubForLog(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, (c) => (c === '\t' ? ' ' : '\uFFFD'));
}

/**
 * Validates OBSIDIAN_LOG_FILE: must resolve to an absolute path that does not
 * escape via `..` segments relative to its resolved directory chain.
 * Returns null when unset.
 */
export function resolveLogFilePath(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const trimmed = raw.trim();
  let expanded = trimmed;
  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  } else if (expanded === '~') {
    expanded = path.join(os.homedir(), 'cursidian.log');
  }
  if (!path.isAbsolute(expanded)) {
    throw new Error(
      `OBSIDIAN_LOG_FILE must be an absolute path after ~ expansion (got "${trimmed}")`,
    );
  }
  const resolved = path.resolve(expanded);
  const home = path.resolve(os.homedir());
  const tmp = path.resolve(os.tmpdir());
  const underHome = resolved === home || resolved.startsWith(home + path.sep);
  const underTmp = resolved === tmp || resolved.startsWith(tmp + path.sep);
  if (!underHome && !underTmp) {
    // Allow absolute paths outside home/tmp only when they have no `..` in the raw form
    // after expansion - already resolved, so reject if original had relative escape intent.
    if (trimmed.includes('..')) {
      throw new Error(`OBSIDIAN_LOG_FILE escapes via "..": ${trimmed}`);
    }
  }
  return resolved;
}

function getValidatedLogFile(): string | null {
  if (validatedLogFile !== undefined) {
    return validatedLogFile;
  }
  try {
    validatedLogFile = resolveLogFilePath(process.env.OBSIDIAN_LOG_FILE);
  } catch (err) {
    validatedLogFile = null;
    process.stderr.write(
      `[FATAL] Invalid OBSIDIAN_LOG_FILE: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  return validatedLogFile;
}

/** Reset cached log-file resolution (tests). */
export function resetLogFileCache(): void {
  if (logFileStream) {
    try {
      logFileStream.end();
    } catch {
      // ignore
    }
    logFileStream = null;
  }
  validatedLogFile = undefined;
}

function ensureLogStream(logFile: string): fs.WriteStream {
  if (logFileStream && !logFileStream.destroyed) {
    return logFileStream;
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  logFileStream = fs.createWriteStream(logFile, { flags: 'a' });
  logFileStream.on('error', () => {
    // best-effort; avoid throwing from the logger
  });
  return logFileStream;
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
  const safeMessage = scrubForLog(message);
  const metaStr = meta ? ` ${scrubForLog(JSON.stringify(meta))}` : '';
  let line = `[${timestamp}] [${level.toUpperCase()}] ${safeMessage}${metaStr}`;
  if (Buffer.byteLength(line, 'utf8') > MAX_LOG_LINE_BYTES) {
    const marker = '…[truncated]';
    while (Buffer.byteLength(line + marker, 'utf8') > MAX_LOG_LINE_BYTES && line.length > 0) {
      line = line.slice(0, Math.floor(line.length * 0.9));
    }
    line = `${line}${marker}`;
  }
  return line;
}

/**
 * Writes a log line to the right sink for stdio MCP.
 * stdout is reserved for JSON-RPC - never use it for logs.
 * Cursor labels all stderr as [error], so INFO/DEBUG avoid stderr unless
 * OBSIDIAN_LOG_FILE is set (append) or OBSIDIAN_LOG_STDERR_INFO=true.
 */
function writeLogLine(level: LogLevel, line: string): void {
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
    return;
  }

  const logFile = getValidatedLogFile();
  if (logFile) {
    try {
      ensureLogStream(logFile).write(`${line}\n`);
    } catch {
      // best-effort
    }
    return;
  }

  if (process.env.OBSIDIAN_LOG_STDERR_INFO === 'true') {
    process.stderr.write(`${line}\n`);
  }
}

/** Emits a leveled log line if it meets the current threshold. */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const line = formatLogLine(level, message, meta);
  writeLogLine(level, line);
}

/** Flushes the async log file sink (shutdown). */
export async function flushLogSink(): Promise<void> {
  const stream = logFileStream;
  if (!stream || stream.destroyed) {
    return;
  }
  await new Promise<void>((resolve) => {
    stream.end(() => resolve());
  });
  logFileStream = null;
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
