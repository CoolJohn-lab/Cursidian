import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('vault (health)', () => {
  it('reports orphans and broken links', async () => {
    await writeNote(
      ctx.vault,
      'concepts/orphan.md',
      '---\ntitle: Orphan\ncategory: concepts\ntags: [x]\nsummary: Alone.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nOrphan body.\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/linker.md',
      '---\ntitle: Linker\ncategory: concepts\ntags: [x]\nsummary: Links out.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nSee [[missing-page]].\n',
    );

    const result = await callTool(ctx.client, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      orphans: Array<{ path: string }>;
      brokenLinks: Array<{ path: string; raw: string }>;
      counts: { orphans: number; brokenLinks: number; ambiguousKeys: number };
      ambiguousKeys: Array<{ key: string; paths: string[] }>;
    };

    expect(data.orphans.some((o) => o.path.includes('orphan'))).toBe(true);
    expect(data.brokenLinks.some((b) => b.raw === 'missing-page')).toBe(true);
    expect(data.counts.orphans).toBeGreaterThan(0);
    expect(data.counts.brokenLinks).toBeGreaterThan(0);
    expect(Array.isArray(data.ambiguousKeys)).toBe(true);
    expect(typeof data.counts.ambiguousKeys).toBe('number');
  });

  it('reports ambiguous alias keys', async () => {
    await writeNote(
      ctx.vault,
      'concepts/collide-a.md',
      '---\ntitle: Collide A\ncategory: concepts\ntags: [x]\nsummary: A.\naliases: [dup-key]\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nA.\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/collide-b.md',
      '---\ntitle: Collide B\ncategory: concepts\ntags: [x]\nsummary: B.\naliases: [dup-key]\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nB.\n',
    );

    const result = await callTool(ctx.client, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      ambiguousKeys: Array<{ key: string; paths: string[] }>;
      counts: { ambiguousKeys: number };
    };

    const hit = data.ambiguousKeys.find((a) => a.key === 'dup-key');
    expect(hit).toBeDefined();
    expect(hit!.paths).toEqual(
      expect.arrayContaining(['concepts/collide-a.md', 'concepts/collide-b.md']),
    );
    expect(data.counts.ambiguousKeys).toBeGreaterThan(0);
  });

  it('reports missing frontmatter and index drift', async () => {
    await writeNote(ctx.vault, 'concepts/incomplete.md', '# No frontmatter\n');
    await writeNote(
      ctx.vault,
      'index.md',
      '---\ntitle: Wiki Index\n---\n\n# Wiki Index\n\n- [[concepts/dead-entry]] - old summary\n',
    );

    const result = await callTool(ctx.client, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      missingFrontmatter: Array<{ path: string }>;
      indexDrift: { deadIndexEntries: string[]; missingFromIndex: string[] };
    };

    expect(data.missingFrontmatter.some((m) => m.path.includes('incomplete'))).toBe(true);
    expect(data.indexDrift.deadIndexEntries).toContain('concepts/dead-entry');
    expect(data.indexDrift.missingFromIndex.some((p) => p.includes('incomplete'))).toBe(true);
  });

  it('reports contradiction callouts with resolved counterparts', async () => {
    await writeNote(
      ctx.vault,
      'concepts/claim-a.md',
      '---\ntitle: Claim A\ncategory: concepts\ntags: [x]\nsummary: Claim A.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n> Contradicts [[concepts/claim-b]]\n\nBody of claim A.\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/claim-b.md',
      '---\ntitle: Claim B\ncategory: concepts\ntags: [x]\nsummary: Claim B.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody of claim B.\n',
    );

    const result = await callTool(ctx.client, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      contradictions: Array<{ path: string; counterpart: string; resolved: boolean }>;
      counts: { contradictions: number };
    };

    const hit = data.contradictions.find((c) => c.path === 'concepts/claim-a.md');
    expect(hit).toBeDefined();
    expect(hit!.counterpart).toBe('concepts/claim-b.md');
    expect(hit!.resolved).toBe(true);
    expect(data.counts.contradictions).toBeGreaterThan(0);
  });

  it('reports an unresolved contradiction target without resolving it', async () => {
    await writeNote(
      ctx.vault,
      'concepts/dangling-contradiction.md',
      '---\ntitle: Dangling Contradiction\ncategory: concepts\ntags: [x]\nsummary: Points at nothing.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n> Contradicts [[concepts/does-not-exist]]\n\nBody.\n',
    );

    const result = await callTool(ctx.client, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      contradictions: Array<{ path: string; counterpart: string; resolved: boolean }>;
    };

    const hit = data.contradictions.find((c) => c.path === 'concepts/dangling-contradiction.md');
    expect(hit).toBeDefined();
    expect(hit!.resolved).toBe(false);
    expect(hit!.counterpart).toBe('concepts/does-not-exist');
  });
});
