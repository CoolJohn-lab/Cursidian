import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, callTool, parseResult, seedVault } from './helpers.js';
import type { TestContext } from './helpers.js';
import fsp from 'node:fs/promises';
import path from 'node:path';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerNote(server, config);
    registerVault(server, config);
  });
  await seedVault(ctx.vault);
  await callTool(ctx.client, 'note', {
    action: 'create',
    path: 'outline-demo.md',
    content: '# Alpha\n\n## Beta\n\n### Gamma\n\n## Delta\n',
    overwrite: true,
  });
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note outline', () => {
  it('returns headings without body content', async () => {
    const result = await callTool(ctx.client, 'note', {
      action: 'outline',
      path: 'outline-demo.md',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      path: string;
      outline: Array<{ level: number; text: string; line: number }>;
      headingCount: number;
      content?: string;
    };
    expect(data.path).toBe('outline-demo.md');
    expect(data.content).toBeUndefined();
    expect(data.headingCount).toBe(4);
    expect(data.outline.map((e) => e.text)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(data.outline[0]).toMatchObject({ level: 1, line: 1 });
  });

  it('respects maxDepth', async () => {
    const result = await callTool(ctx.client, 'note', {
      action: 'outline',
      path: 'outline-demo.md',
      maxDepth: 2,
    });
    const data = parseResult(result) as {
      outline: Array<{ text: string }>;
      maxDepth: number;
    };
    expect(data.maxDepth).toBe(2);
    expect(data.outline.map((e) => e.text)).toEqual(['Alpha', 'Beta', 'Delta']);
  });
});

describe('note update dryRun', () => {
  it('previews a patch without writing or journaling', async () => {
    const before = await fsp.readFile(path.join(ctx.vault, 'outline-demo.md'), 'utf-8');
    const historyBefore = parseResult(
      await callTool(ctx.client, 'vault', { action: 'history', limit: 50 }),
    ) as { operations: Array<{ operationId: string }> };
    const idsBefore = new Set(historyBefore.operations.map((o) => o.operationId));

    const result = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'outline-demo.md',
      mode: 'patch',
      old_string: '### Gamma',
      new_string: '### Gamma changed',
      dryRun: true,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      dryRun: boolean;
      wouldChange: boolean;
      path: string;
      currentRevision: string;
      nextContentHash: string;
      nextRevisionHash: string;
      sizeGuardPassed: boolean;
      operationId?: string;
    };
    expect(data.dryRun).toBe(true);
    expect(data.wouldChange).toBe(true);
    expect(data.sizeGuardPassed).toBe(true);
    expect(data.path).toBe('outline-demo.md');
    expect(data.currentRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(data.nextRevisionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.nextRevisionHash).not.toBe(data.currentRevision);
    expect(data.operationId).toBeUndefined();

    const after = await fsp.readFile(path.join(ctx.vault, 'outline-demo.md'), 'utf-8');
    expect(after).toBe(before);

    const historyAfter = parseResult(
      await callTool(ctx.client, 'vault', { action: 'history', limit: 50 }),
    ) as { operations: Array<{ operationId: string }> };
    const newOps = historyAfter.operations.filter((o) => !idsBefore.has(o.operationId));
    expect(newOps).toHaveLength(0);
  });

  it('returns wouldChange and hashes for a dryRun patch preview', async () => {
    const result = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'outline-demo.md',
      mode: 'patch',
      old_string: '### Gamma',
      new_string: '### Gamma',
      dryRun: true,
    });
    const data = parseResult(result) as {
      dryRun: boolean;
      wouldChange: boolean;
      nextRevisionHash: string;
      operationId?: string;
    };
    expect(data.dryRun).toBe(true);
    expect(typeof data.wouldChange).toBe('boolean');
    expect(data.nextRevisionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.operationId).toBeUndefined();
  });
});
