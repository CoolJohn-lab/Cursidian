import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, callTool, parseResult, writeNote } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  registerVault(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('vault (sync_index)', () => {
  it('dryRun returns generated markdown without writing', async () => {
    await writeNote(
      ctx.vault,
      'concepts/alpha.md',
      '---\ntitle: Alpha\ncategory: concepts\ntags: [wiki]\nsummary: First note.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Alpha\n',
    );

    const result = await callTool(ctx.server, 'vault', { action: 'sync_index', dryRun: true });
    const data = parseResult(result) as { wouldWrite: boolean; markdown: string; noteCount: number; categories: string[] };

    expect(data.wouldWrite).toBe(true);
    expect(data.markdown).toContain('## Concepts');
    expect(data.markdown).toContain('[[concepts/alpha]]');
    expect(data.noteCount).toBeGreaterThan(0);
    expect(data.categories).toContain('concepts');
  });

  it('writes index.md grouped by category', async () => {
    await writeNote(
      ctx.vault,
      'entities/beta.md',
      '---\ntitle: Beta\ncategory: entities\ntags: [entity]\nsummary: Entity note.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Beta\n',
    );

    const result = await callTool(ctx.server, 'vault', { action: 'sync_index' });
    const data = parseResult(result) as { updated: string; noteCount: number; categories: string[] };
    expect(data.updated).toBe('index.md');

    const raw = await fs.readFile(path.join(ctx.vault, 'index.md'), 'utf-8');
    expect(raw).toContain('## Entities');
    expect(raw).toContain('[[entities/beta]]');
    expect(raw).toContain('Entity note.');
  });
});
