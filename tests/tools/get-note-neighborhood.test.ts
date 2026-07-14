import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { registerGraph } from '../../src/tools/graph.js';
import { registerSearch } from '../../src/tools/search.js';
import {
  createTestVault,
  createTestContextAt,
  seedVault,
  cleanupVault,
  writeNote,
  callTool,
  parseResult,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerGraph(server, config);
    registerSearch(server, config);
  });
  await seedVault(ctx.vault);
  await writeNote(ctx.vault, 'hub.md', '---\ntitle: Hub\n---\n\nSee [[spoke]]');
  await writeNote(ctx.vault, 'spoke.md', '---\ntitle: Spoke\n---\n\nBack to [[hub]]');
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('graph', () => {
  it('returns outgoing links and backlinks', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'hub' });
    const data = parseResult(result) as {
      outgoingLinks: Array<{ raw: string; resolvedPath: string | null }>;
      backlinks: Array<{ path: string }>;
    };
    expect(data.outgoingLinks.some((l) => l.resolvedPath === 'spoke.md')).toBe(true);
    expect(data.backlinks.some((b) => b.path === 'spoke.md' || b.path.includes('spoke'))).toBe(
      true,
    );
  });

  it('finds backlinks to a seeded note', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'Resources/book' });
    const data = parseResult(result) as { backlinks: Array<{ path: string }> };
    expect(data.backlinks.length).toBeGreaterThan(0);
  });

  it('returns empty backlinks for note with no incoming links', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'Daily/2024-01-16' });
    const data = parseResult(result) as { backlinkCount: number };
    expect(typeof data.backlinkCount).toBe('number');
  });

  it('resolves graph path via frontmatter alias', async () => {
    await writeNote(
      ctx.vault,
      'entities/alias-hub.md',
      '---\ntitle: Alias Hub\naliases:\n  - alias-hub-key\n---\n\nSee [[spoke]]\n',
    );
    const result = await callTool(ctx.client, 'graph', { path: 'alias-hub-key' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { note: string };
    expect(data.note).toBe('entities/alias-hub.md');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.client, 'graph', { path: '../../../etc/passwd' });
    expect(result.isError).toBe(true);
  });

  it('reports a structured note_not_found error for an unknown path', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'nowhere/does-not-exist' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; recovery?: { tool: string } };
    expect(data.error).toBe('note_not_found');
    expect(data.recovery?.tool).toBe('search');
  });

  it('returns an empty neighborhood for an isolated note', async () => {
    await writeNote(
      ctx.vault,
      'entities/isolated.md',
      '---\ntitle: Isolated\n---\n\nNo links here at all.',
    );
    const result = await callTool(ctx.client, 'graph', { path: 'entities/isolated' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      outgoingLinks: unknown[];
      unresolvedOutgoingLinks: unknown[];
      backlinks: unknown[];
      backlinkCount: number;
      truncated: boolean;
      nextCursor?: string;
    };
    expect(data.outgoingLinks).toEqual([]);
    expect(data.unresolvedOutgoingLinks).toEqual([]);
    expect(data.backlinks).toEqual([]);
    expect(data.backlinkCount).toBe(0);
    expect(data.truncated).toBe(false);
    expect(data.nextCursor).toBeUndefined();
  });

  it('lists unresolved outgoing links alongside resolved ones', async () => {
    await writeNote(
      ctx.vault,
      'entities/mixed-links.md',
      '---\ntitle: Mixed Links\n---\n\nSee [[hub]] and also [[totally-missing-target]].',
    );
    const result = await callTool(ctx.client, 'graph', { path: 'entities/mixed-links' });
    const data = parseResult(result) as {
      outgoingLinks: Array<{ raw: string; resolvedPath: string | null }>;
      unresolvedOutgoingLinks: Array<{ raw: string }>;
    };
    expect(data.outgoingLinks.some((l) => l.resolvedPath === 'hub.md')).toBe(true);
    expect(data.outgoingLinks.every((l) => l.resolvedPath !== null)).toBe(true);
    expect(data.unresolvedOutgoingLinks).toEqual([{ raw: 'totally-missing-target' }]);
  });

  it('paginates many backlinks with limit=1 across every page', async () => {
    await writeNote(
      ctx.vault,
      'entities/popular.md',
      '---\ntitle: Popular\n---\n\nNo outgoing links.',
    );
    await writeNote(
      ctx.vault,
      'entities/linker-a.md',
      '---\ntitle: Linker A\n---\n\nSee [[entities/popular]].',
    );
    await writeNote(
      ctx.vault,
      'entities/linker-b.md',
      '---\ntitle: Linker B\n---\n\nSee [[entities/popular]].',
    );
    await writeNote(
      ctx.vault,
      'entities/linker-c.md',
      '---\ntitle: Linker C\n---\n\nSee [[entities/popular]].',
    );

    const seenPaths = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    for (let i = 0; i < 10; i++) {
      const result = await callTool(ctx.client, 'graph', {
        path: 'entities/popular',
        limit: 1,
        cursor,
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as {
        backlinks: Array<{ path: string }>;
        backlinkCount: number;
        truncated: boolean;
        nextCursor?: string;
        effectiveLimit: number;
      };
      expect(data.effectiveLimit).toBe(1);
      expect(data.backlinkCount).toBe(3);
      expect(data.backlinks).toHaveLength(1);
      seenPaths.add(data.backlinks[0].path);
      pages += 1;

      if (!data.truncated) {
        expect(data.nextCursor).toBeUndefined();
        break;
      }
      expect(data.nextCursor).toBeTruthy();
      cursor = data.nextCursor;
    }

    expect(pages).toBe(3);
    expect(seenPaths).toEqual(
      new Set(['entities/linker-a.md', 'entities/linker-b.md', 'entities/linker-c.md']),
    );
  });

  it('surfaces skipped files as incomplete when a note is too large to scan', async () => {
    const capped = await createTestContextAt(
      await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-graph-capped-')),
      { maxFileSize: 256 },
      (server, config) => {
        registerGraph(server, config);
      },
    );
    await writeNote(capped.vault, 'entities/normal.md', '---\ntitle: Normal\n---\n\nBody.');
    await writeNote(
      capped.vault,
      'entities/huge.md',
      `---\ntitle: Huge\n---\n\n${'x'.repeat(1024)}`,
    );

    const result = await callTool(capped.client, 'graph', { path: 'entities/normal' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { incomplete: boolean; skipped: Array<{ path: string }> };
    expect(data.incomplete).toBe(true);
    expect(data.skipped.some((entry) => entry.path.includes('huge.md'))).toBe(true);

    await cleanupVault(capped.vault);
  });
});
