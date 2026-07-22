import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { registerContext } from '../../src/tools/context.js';
import {
  createTestVault,
  createTestContextAt,
  cleanupVault,
  writeNote,
  callTool,
  parseResult,
} from './helpers.js';
import type { TestContext } from './helpers.js';
import type { ContextBundle } from '../../src/types/index.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerContext(server, config);
  });
  await writeNote(
    ctx.vault,
    'ingestion-overview.md',
    '---\ntitle: Ingestion Overview\nsummary: UniqueContextToolMarker summary describing ingestion.\n---\n\n# Ingestion Overview\n\nUniqueContextToolMarker body.\n',
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('context (assemble)', () => {
  it('assembles a bundle for a query with a default token budget', async () => {
    const result = await callTool(ctx.client, 'context', { action: 'assemble', query: 'UniqueContextToolMarker' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ContextBundle;
    expect(data.query).toBe('UniqueContextToolMarker');
    expect(data.tokenBudget).toBe(4000);
    expect(data.tokensUsed).toBeLessThanOrEqual(data.tokenBudget);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.citations.length).toBeGreaterThan(0);
    expect(data.focus).toBeDefined();
    expect(data.focus!.length).toBeGreaterThan(0);
    expect(data.guidance).toBeDefined();
    expect(['sufficient', 'expand', 'refine_query']).toContain(data.guidance!.nextStep);
  });

  it('defaults action to assemble when omitted', async () => {
    const result = await callTool(ctx.client, 'context', { query: 'UniqueContextToolMarker' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ContextBundle;
    expect(data.items.length).toBeGreaterThan(0);
  });

  it('honours an explicit tokenBudget and intent', async () => {
    const result = await callTool(ctx.client, 'context', {
      action: 'assemble',
      query: 'UniqueContextToolMarker',
      intent: 'lookup',
      tokenBudget: 10,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ContextBundle;
    expect(data.intent).toBe('lookup');
    expect(data.tokenBudget).toBe(10);
    expect(data.tokensUsed).toBeLessThanOrEqual(10);
  });

  it('rejects assemble without a query', async () => {
    const result = await callTool(ctx.client, 'context', { action: 'assemble' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; details?: { missing?: string[] } };
    expect(data.error).toBe('invalid_args');
    expect(data.details?.missing).toContain('query');
  });

  it('rejects arguments that do not apply to the action', async () => {
    const result = await callTool(ctx.client, 'context', {
      action: 'assemble',
      query: 'UniqueContextToolMarker',
      cursor: 'not-allowed-here',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; details?: { rejected?: string[] } };
    expect(data.error).toBe('invalid_args');
    expect(data.details?.rejected).toContain('cursor');
  });
});

describe('context (for_task)', () => {
  it('assembles a bundle from a task description', async () => {
    const result = await callTool(ctx.client, 'context', {
      action: 'for_task',
      task: 'What is UniqueContextToolMarker',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ContextBundle;
    expect(data.items.length).toBeGreaterThan(0);
  });

  it('rejects for_task without a task', async () => {
    const result = await callTool(ctx.client, 'context', { action: 'for_task' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; details?: { missing?: string[] } };
    expect(data.details?.missing).toContain('task');
  });
});

describe('context (expand)', () => {
  it('continues a prior bundle via nextCursor, excluding already-seen paths', async () => {
    await writeNote(
      ctx.vault,
      'expand-tool-a.md',
      '---\ntitle: Expand Tool A\nsummary: UniqueExpandToolMarker summary A.\n---\n\nBody A.',
    );
    await writeNote(
      ctx.vault,
      'expand-tool-b.md',
      '---\ntitle: Expand Tool B\nsummary: UniqueExpandToolMarker summary B.\n---\n\nBody B.',
    );

    const first = parseResult(
      await callTool(ctx.client, 'context', { action: 'assemble', query: 'UniqueExpandToolMarker' }),
    ) as ContextBundle;
    expect(first.nextCursor).toBeTruthy();

    const expanded = parseResult(
      await callTool(ctx.client, 'context', {
        action: 'expand',
        cursor: first.nextCursor,
        tokenBudget: 4000,
      }),
    ) as ContextBundle;

    for (const consideredPath of expanded.coverage.consideredPaths) {
      expect(first.coverage.consideredPaths).not.toContain(consideredPath);
    }
  });

  it('rejects expand without a cursor', async () => {
    const result = await callTool(ctx.client, 'context', { action: 'expand' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; details?: { missing?: string[] } };
    expect(data.details?.missing).toContain('cursor');
  });

  it('returns a structured invalid_args error for a forged cursor', async () => {
    const result = await callTool(ctx.client, 'context', { action: 'expand', cursor: 'not-a-real-cursor' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; retryable?: boolean };
    expect(data.error).toBe('invalid_args');
    expect(data.retryable).toBe(true);
  });
});

describe('context (telemetry)', () => {
  const telemetryFile = () => path.join(ctx.vault, '.cursidian', 'context-telemetry.jsonl');

  afterAll(() => {
    delete process.env.OBSIDIAN_CONTEXT_TELEMETRY;
  });

  it('does not write telemetry when OBSIDIAN_CONTEXT_TELEMETRY is unset (default off)', async () => {
    delete process.env.OBSIDIAN_CONTEXT_TELEMETRY;
    await callTool(ctx.client, 'context', { action: 'assemble', query: 'UniqueContextToolMarker' });
    await expect(fsp.access(telemetryFile())).rejects.toThrow();
  });

  it('writes a local JSONL entry with query shape (not raw text) when enabled', async () => {
    process.env.OBSIDIAN_CONTEXT_TELEMETRY = 'true';
    try {
      await callTool(ctx.client, 'context', { action: 'assemble', query: 'UniqueContextToolMarker' });
      const raw = await fsp.readFile(telemetryFile(), 'utf-8');
      const lines = raw.trim().split('\n');
      const lastEntry = JSON.parse(lines[lines.length - 1]!) as {
        action: string;
        queryShape: { length: number; wordCount: number };
        intent: string;
        tokenBudget: number;
        tokensUsed: number;
        itemCount: number;
        bundleConfidence: number;
        warningCount: number;
        latencyMs: number;
      };
      expect(lastEntry.action).toBe('assemble');
      expect(lastEntry.queryShape).toEqual({ length: 'UniqueContextToolMarker'.length, wordCount: 1 });
      expect(JSON.stringify(lastEntry)).not.toContain('UniqueContextToolMarker');
      expect(typeof lastEntry.tokenBudget).toBe('number');
      expect(typeof lastEntry.latencyMs).toBe('number');
      expect(lastEntry.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      delete process.env.OBSIDIAN_CONTEXT_TELEMETRY;
    }
  });
});

describe('context (logdump)', () => {
  let dumpDir: string;

  beforeAll(async () => {
    dumpDir = await fsp.mkdtemp(path.join(path.dirname(ctx.vault), 'context-logdump-'));
  });

  afterAll(async () => {
    delete process.env.OBSIDIAN_CONTEXT_LOGDUMP;
    delete process.env.OBSIDIAN_CONTEXT_LOGDUMP_DIR;
    process.env.OBSIDIAN_CONTEXT_LOGDUMP = 'false';
    await fsp.rm(dumpDir, { recursive: true, force: true });
  });

  it('writes full input + output to the logdump directory when enabled', async () => {
    process.env.OBSIDIAN_CONTEXT_LOGDUMP = 'true';
    process.env.OBSIDIAN_CONTEXT_LOGDUMP_DIR = dumpDir;

    await callTool(ctx.client, 'context', {
      action: 'assemble',
      query: 'UniqueContextToolMarker',
      tokenBudget: 2000,
      intent: 'lookup',
    });

    const files = await fsp.readdir(dumpDir);
    const jsonl = files.find((f) => f.endsWith('.jsonl'));
    expect(jsonl).toBeTruthy();
    const raw = await fsp.readFile(path.join(dumpDir, jsonl!), 'utf-8');
    const entry = JSON.parse(raw.trim().split('\n').at(-1)!) as {
      schemaVersion: number;
      status: string;
      input: { action: string; query: string; intent: string; tokenBudget: number };
      output: { query: string; tokensUsed: number; items: unknown[] };
      quality: { sufficiency: boolean; tokensUsed: number };
      ranking: { searchHits: unknown[]; itemsCompact: unknown[] };
    };
    expect(entry.schemaVersion).toBe(2);
    expect(entry.status).toBe('success');
    expect(entry.input).toMatchObject({
      action: 'assemble',
      query: 'UniqueContextToolMarker',
      intent: 'lookup',
      tokenBudget: 2000,
    });
    expect(entry.output.query).toBe('UniqueContextToolMarker');
    expect(entry.output.items.length).toBeGreaterThan(0);
    expect(entry.quality.tokensUsed).toBe(entry.output.tokensUsed);
    expect(entry.ranking.itemsCompact.length).toBe(entry.output.items.length);
  });
});

describe('context (feedback)', () => {
  it('records feedback to a local vault file and returns changed: true', async () => {
    const result = await callTool(ctx.client, 'context', {
      action: 'feedback',
      feedbackQuery: 'UniqueContextToolMarker',
      feedbackVerdict: 'insufficient',
      feedbackNote: 'missing the migration steps',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { changed: boolean; path: string; recorded: boolean };
    expect(data.changed).toBe(true);
    expect(data.recorded).toBe(true);

    const raw = await fsp.readFile(path.join(ctx.vault, '.cursidian', 'context-feedback.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    const lastEntry = JSON.parse(lines[lines.length - 1]!) as { query: string; verdict: string };
    expect(lastEntry.query).toBe('UniqueContextToolMarker');
    expect(lastEntry.verdict).toBe('insufficient');
  });

  it('rejects feedback without required fields', async () => {
    const result = await callTool(ctx.client, 'context', { action: 'feedback', feedbackQuery: 'x' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; details?: { missing?: string[] } };
    expect(data.details?.missing).toContain('feedbackVerdict');
  });

  it('rejects feedback when the vault is read-only', async () => {
    const readOnlyCtx = await createTestContextAt(ctx.vault, { readOnly: true }, (server, config) => {
      registerContext(server, config);
    });
    const result = await callTool(readOnlyCtx.client, 'context', {
      action: 'feedback',
      feedbackQuery: 'x',
      feedbackVerdict: 'off_target',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('read_only');
  });
});
