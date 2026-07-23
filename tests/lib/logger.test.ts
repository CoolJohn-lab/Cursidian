import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatLogLine,
  flushLogSink,
  logger,
  resetLogFileCache,
  setLogLevel,
} from '../../src/lib/logger.js';

describe('formatLogLine', () => {
  it('includes level, message, and optional meta', () => {
    const line = formatLogLine(
      'info',
      'Note created',
      { path: 'a.md' },
      '2026-07-13T00:00:00.000Z',
    );
    expect(line).toBe('[2026-07-13T00:00:00.000Z] [INFO] Note created {"path":"a.md"}');
  });

  it('scrubs newlines from logged messages to prevent log-line forgery', () => {
    const line = formatLogLine('info', 'path is evil\n[FATAL] forged', {});
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain('\n');
  });
});

describe('logger sinks', () => {
  const originalLogFile = process.env.OBSIDIAN_LOG_FILE;
  const originalStderrInfo = process.env.OBSIDIAN_LOG_STDERR_INFO;

  afterEach(async () => {
    await flushLogSink();
    resetLogFileCache();
    if (originalLogFile === undefined) delete process.env.OBSIDIAN_LOG_FILE;
    else process.env.OBSIDIAN_LOG_FILE = originalLogFile;
    if (originalStderrInfo === undefined) delete process.env.OBSIDIAN_LOG_STDERR_INFO;
    else process.env.OBSIDIAN_LOG_STDERR_INFO = originalStderrInfo;
    setLogLevel('info');
    vi.restoreAllMocks();
  });

  it('does not write INFO to stderr by default (avoids Cursor false [error])', () => {
    delete process.env.OBSIDIAN_LOG_FILE;
    delete process.env.OBSIDIAN_LOG_STDERR_INFO;
    setLogLevel('info');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('cursidian starting', { vault: '/tmp/vault' });

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('writes ERROR to stderr and never to stdout', () => {
    delete process.env.OBSIDIAN_LOG_FILE;
    delete process.env.OBSIDIAN_LOG_STDERR_INFO;
    setLogLevel('info');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.error('boom', { code: 1 });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('[ERROR] boom');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('appends INFO to OBSIDIAN_LOG_FILE when configured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursidian-log-'));
    const logFile = path.join(dir, 'mcp.log');
    process.env.OBSIDIAN_LOG_FILE = logFile;
    delete process.env.OBSIDIAN_LOG_STDERR_INFO;
    resetLogFileCache();
    setLogLevel('info');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('Note created', { path: 'x.md' });
    await flushLogSink();

    expect(stderrSpy).not.toHaveBeenCalled();
    const contents = fs.readFileSync(logFile, 'utf8');
    expect(contents).toContain('[INFO] Note created');
    expect(contents).toContain('"path":"x.md"');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
