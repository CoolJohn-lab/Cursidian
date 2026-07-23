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
      output: {
        query: 'metadata sql ProcessQueue',
        intent: 'lookup',
        tokenBudget: 3000,
        tokensUsed: 100,
        items: [
          {
            path: 'a.md',
            title: 'A',
            kind: 'summary',
            text: 'x',
            score: 1,
            reasons: [],
            tokens: 100,
          },
        ],
        coverage: { includedPaths: ['a.md'], consideredPaths: ['a'], droppedForBudget: [] },
        warnings: [],
        citations: [],
        bundleConfidence: 0.9,
        focus: ['a.md'],
        guidance: { nextStep: 'sufficient', reason: 'ok' },
      },
      ranking: {
        searchHits: [{ path: 'a.md', score: 10, reasons: ['basename'] }],
        candidatesAfterRerank: [{ path: 'a.md', score: 10, reasons: ['basename'] }],
        itemsCompact: [
          { path: 'a.md', title: 'A', kind: 'summary', score: 1, tokens: 100, reasons: [] },
        ],
        droppedCompact: [],
      },
      env: { OBSIDIAN_CONTEXT_LOGDUMP_DIR: tempDir },
    });
    expect(result.written).toBe(true);
    expect(result.path).toBeTruthy();

    const raw = await fs.readFile(result.path!, 'utf-8');
    const entry = JSON.parse(raw.trim()) as {
      schemaVersion: number;
      packageVersion: string;
      callId: string;
      status: string;
      latencyMs: number;
      input: { query: string };
      output: { tokensUsed: number };
      quality: { sufficiency: boolean; depthShare: number; tokensUsed: number };
      ranking: { searchHits: unknown[] };
    };
    expect(entry.schemaVersion).toBe(2);
    expect(entry.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(entry.callId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(entry.status).toBe('success');
    expect(entry.latencyMs).toBe(12);
    expect(entry.input.query).toBe('metadata sql ProcessQueue');
    expect(entry.output.tokensUsed).toBe(100);
    expect(entry.quality.sufficiency).toBe(true);
    expect(entry.quality.tokensUsed).toBe(100);
    expect(entry.quality.depthShare).toBe(0);
    expect(entry.ranking.searchHits).toHaveLength(1);
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
