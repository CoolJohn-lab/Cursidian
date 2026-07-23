import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerVault } from '../../src/tools/vault.js';
import { clearSlopRulesCache } from '../../src/lib/slop.js';
import { createTestContextAt, cleanupVault, callTool, parseResult, writeNote } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  clearSlopRulesCache();
  ctx = await createTestContextAt(
    await fs.mkdtemp(path.join(os.tmpdir(), 'cursidian-vault-slop-')),
    { backupEnabled: true },
    (server, config) => {
      registerVault(server, config);
    },
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('vault slop_check / deslop', () => {
  it('slop_check is zero-write and reports body + frontmatter findings', async () => {
    await writeNote(
      ctx.vault,
      'concepts/sloppy.md',
      '---\ntitle: Sloppy\ncategory: concepts\ntags: [wiki]\nsummary: Offline — resync later.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Sloppy\n\nBody with an em dash — here.\n',
    );

    const before = await fs.readFile(path.join(ctx.vault, 'concepts/sloppy.md'), 'utf8');
    const result = await callTool(ctx.client, 'vault', { action: 'slop_check' });
    const data = parseResult(result) as {
      wouldChange: boolean;
      summariesWouldChange: boolean;
      findings: Array<{ path: string; region: string; code: string }>;
      filesToChange: Array<{ path: string; summaryChanged: boolean }>;
    };

    expect(data.wouldChange).toBe(true);
    expect(data.summariesWouldChange).toBe(true);
    expect(data.findings.some((f) => f.region === 'body' && f.code === 'char')).toBe(true);
    expect(data.findings.some((f) => f.region === 'frontmatter' && f.code === 'char')).toBe(true);
    expect(
      data.filesToChange.some((f) => f.path === 'concepts/sloppy.md' && f.summaryChanged),
    ).toBe(true);

    const after = await fs.readFile(path.join(ctx.vault, 'concepts/sloppy.md'), 'utf8');
    expect(after).toBe(before);
  });

  it('deslop dryRun previews without writing', async () => {
    const before = await fs.readFile(path.join(ctx.vault, 'concepts/sloppy.md'), 'utf8');
    const result = await callTool(ctx.client, 'vault', { action: 'deslop', dryRun: true });
    const data = parseResult(result) as { wouldChange: boolean; filesToChange: unknown[] };
    expect(data.wouldChange).toBe(true);
    expect(data.filesToChange.length).toBeGreaterThan(0);
    const after = await fs.readFile(path.join(ctx.vault, 'concepts/sloppy.md'), 'utf8');
    expect(after).toBe(before);
  });

  it('deslop requires confirm: true', async () => {
    const result = await callTool(ctx.client, 'vault', { action: 'deslop' });
    const data = parseResult(result) as { error?: string; code?: string };
    expect(data.error || data.code).toBeTruthy();
  });

  it('deslop fixes body + frontmatter, syncs index, and supports undo', async () => {
    // Clear leftover dirty notes from earlier cases in this suite.
    await writeNote(
      ctx.vault,
      'concepts/sloppy.md',
      '---\ntitle: Sloppy\ncategory: concepts\ntags: [wiki]\nsummary: Already clean.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Sloppy\n\nClean body.\n',
    );

    await writeNote(
      ctx.vault,
      'concepts/alpha.md',
      '---\ntitle: Alpha\ncategory: concepts\ntags: [wiki]\nsummary: First note — clean me.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Alpha\n\nHello — world.\n',
    );
    await callTool(ctx.client, 'vault', { action: 'sync_index' });

    // Deliberately pollute index catalog line while leaving frontmatter dirty so
    // health would see drift if only the index body were fixed.
    const indexPath = path.join(ctx.vault, 'index.md');
    let indexRaw = await fs.readFile(indexPath, 'utf8');
    indexRaw = indexRaw.replace('First note — clean me.', 'First note - clean me.');
    await fs.writeFile(indexPath, indexRaw, 'utf8');

    const healthBefore = parseResult(await callTool(ctx.client, 'vault', { action: 'health' })) as {
      counts: { indexDrift: number };
      indexDrift: { summaryMismatches: unknown[] };
    };
    expect(healthBefore.counts.indexDrift).toBeGreaterThan(0);

    const deslopResult = await callTool(ctx.client, 'vault', { action: 'deslop', confirm: true });
    expect(deslopResult.isError).toBeFalsy();
    const deslop = parseResult(deslopResult) as {
      operationId: string;
      undoAvailable: boolean;
      changedFiles: Array<{ path: string }>;
      indexSynced: boolean;
      summariesChanged: boolean;
    };

    expect(deslop.undoAvailable).toBe(true);
    expect(deslop.operationId).toBeTruthy();
    expect(deslop.summariesChanged).toBe(true);
    expect(deslop.indexSynced).toBe(true);
    expect(deslop.changedFiles.some((f) => f.path === 'concepts/alpha.md')).toBe(true);

    const alpha = await fs.readFile(path.join(ctx.vault, 'concepts/alpha.md'), 'utf8');
    expect(alpha).not.toContain('\u2014');
    expect(alpha).toContain('First note - clean me.');
    expect(alpha).toContain('Hello - world.');

    const healthAfter = parseResult(await callTool(ctx.client, 'vault', { action: 'health' })) as {
      counts: { indexDrift: number };
      indexDrift: { summaryMismatches: unknown[] };
    };
    expect(healthAfter.counts.indexDrift).toBe(0);
    expect(healthAfter.indexDrift.summaryMismatches).toEqual([]);

    const checkClean = parseResult(
      await callTool(ctx.client, 'vault', { action: 'slop_check' }),
    ) as { wouldChange: boolean; counts: { findings: number } };
    expect(checkClean.wouldChange).toBe(false);

    const undone = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId: deslop.operationId,
      confirm: true,
    });
    expect(undone.isError).toBeFalsy();

    const restored = await fs.readFile(path.join(ctx.vault, 'concepts/alpha.md'), 'utf8');
    expect(restored).toContain('\u2014');
  });
});
