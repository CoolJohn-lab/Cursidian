import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultContextLogdumpDir,
  recordContextLogdump,
  resolveContextLogdumpDir,
} from '../../src/lib/context-logdump.js';

describe('context-logdump', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('defaults to ~/.cursor/logdump/ContextSearches', () => {
    expect(defaultContextLogdumpDir()).toBe(
      path.join(os.homedir(), '.cursor', 'logdump', 'ContextSearches'),
    );
    expect(resolveContextLogdumpDir({})).toBe(defaultContextLogdumpDir());
  });

  it('disables when OBSIDIAN_CONTEXT_LOGDUMP is false/off', () => {
    expect(resolveContextLogdumpDir({ OBSIDIAN_CONTEXT_LOGDUMP: 'false' })).toBeNull();
    expect(resolveContextLogdumpDir({ OBSIDIAN_CONTEXT_LOGDUMP: 'off' })).toBeNull();
    expect(resolveContextLogdumpDir({ OBSIDIAN_CONTEXT_LOGDUMP: '0' })).toBeNull();
  });

  it('honours OBSIDIAN_CONTEXT_LOGDUMP_DIR override', () => {
    expect(resolveContextLogdumpDir({ OBSIDIAN_CONTEXT_LOGDUMP_DIR: '/tmp/ctx-dumps' })).toBe(
      path.resolve('/tmp/ctx-dumps'),
    );
  });

  it('appends a full input/output JSONL line', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursidian-logdump-'));
    const result = await recordContextLogdump({
      latencyMs: 12,
      status: 'success',
      input: { action: 'assemble', query: 'metadata sql ProcessQueue', tokenBudget: 3000 },
      output: { tokensUsed: 100, items: [{ path: 'a.md', kind: 'summary' }] },
      env: { OBSIDIAN_CONTEXT_LOGDUMP_DIR: tempDir },
    });
    expect(result.written).toBe(true);
    expect(result.path).toBeTruthy();

    const raw = await fs.readFile(result.path!, 'utf-8');
    const entry = JSON.parse(raw.trim()) as {
      status: string;
      latencyMs: number;
      input: { query: string };
      output: { tokensUsed: number };
    };
    expect(entry.status).toBe('success');
    expect(entry.latencyMs).toBe(12);
    expect(entry.input.query).toBe('metadata sql ProcessQueue');
    expect(entry.output.tokensUsed).toBe(100);
  });

  it('no-ops when disabled without throwing', async () => {
    const result = await recordContextLogdump({
      latencyMs: 1,
      status: 'error',
      input: { action: 'assemble' },
      output: { error: 'x' },
      env: { OBSIDIAN_CONTEXT_LOGDUMP: 'false' },
    });
    expect(result).toEqual({ written: false });
  });
});
