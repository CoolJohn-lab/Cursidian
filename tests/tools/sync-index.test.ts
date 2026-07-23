import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, callTool, parseResult, writeNote } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerVault(server, config);
  });
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

    const result = await callTool(ctx.client, 'vault', { action: 'sync_index', dryRun: true });
    const data = parseResult(result) as {
      wouldWrite: boolean;
      markdown: string;
      noteCount: number;
      categories: string[];
    };

    expect(data.wouldWrite).toBe(true);
    expect(data.markdown).toContain('## Concepts');
    expect(data.markdown).toContain('[[concepts/alpha]]');
    expect(data.noteCount).toBeGreaterThan(0);
    expect(data.categories).toContain('concepts');
  });

  it('dryRun reports wouldWrite false when catalog body is unchanged', async () => {
    await callTool(ctx.client, 'vault', { action: 'sync_index' });
    const result = await callTool(ctx.client, 'vault', { action: 'sync_index', dryRun: true });
    const data = parseResult(result) as { wouldWrite: boolean };
    expect(data.wouldWrite).toBe(false);
  });

  it('writes index.md grouped by category', async () => {
    await writeNote(
      ctx.vault,
      'entities/beta.md',
      '---\ntitle: Beta\ncategory: entities\ntags: [entity]\nsummary: Entity note.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Beta\n',
    );

    const result = await callTool(ctx.client, 'vault', { action: 'sync_index' });
    const data = parseResult(result) as {
      updated: string;
      noteCount: number;
      categories: string[];
      indexMode: string;
    };
    expect(data.updated).toBe('index.md');
    expect(data.indexMode).toBe('flat');

    const raw = await fs.readFile(path.join(ctx.vault, 'index.md'), 'utf-8');
    expect(raw).toContain('## Entities');
    expect(raw).toContain('[[entities/beta]]');
    expect(raw).toContain('Entity note.');
  });

  it('hub mode preserves curated router without dumping every leaf', async () => {
    await writeNote(
      ctx.vault,
      'projects/dlz-hub.md',
      '---\ntitle: DLZ Hub\ncategory: projects\ntags: [hub]\nsummary: Hub page for DLZ.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n| [[projects/dlz-leaf]] | Leaf |\n',
    );
    await writeNote(
      ctx.vault,
      'projects/dlz-leaf.md',
      '---\ntitle: DLZ Leaf\ncategory: projects\ntags: [leaf]\nsummary: Should stay off root index.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nLeaf.\n',
    );
    await writeNote(
      ctx.vault,
      'index.md',
      '---\ntitle: Wiki Index\nindexMode: hub\n---\n\n# Wiki Index\n\n## Projects\n\nCurated router only.\n\n- [[projects/dlz-hub]] - short blurb ( #hub)\n',
    );

    const dryBefore = parseResult(
      await callTool(ctx.client, 'vault', { action: 'sync_index', dryRun: true }),
    ) as { wouldWrite: boolean; markdown: string; indexMode: string; noteCount: number };

    expect(dryBefore.indexMode).toBe('hub');
    expect(dryBefore.wouldWrite).toBe(false);
    expect(dryBefore.markdown).toContain('short blurb');
    expect(dryBefore.markdown).not.toContain('[[projects/dlz-leaf]]');
    expect(dryBefore.markdown).toContain('Curated router only.');
    expect(dryBefore.noteCount).toBe(1);

    const health = parseResult(await callTool(ctx.client, 'vault', { action: 'health' })) as {
      indexMode: string;
      indexDrift: { missingFromIndex: string[]; summaryMismatches: unknown[] };
    };
    expect(health.indexMode).toBe('hub');
    expect(health.indexDrift.missingFromIndex).not.toContain('projects/dlz-leaf.md');
    expect(health.indexDrift.summaryMismatches).toEqual([]);
  });
});
