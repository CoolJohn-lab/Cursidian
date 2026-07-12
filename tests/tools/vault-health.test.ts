import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

    const result = await callTool(ctx.server, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      orphans: Array<{ path: string }>;
      brokenLinks: Array<{ path: string; raw: string }>;
      counts: { orphans: number; brokenLinks: number };
    };

    expect(data.orphans.some((o) => o.path.includes('orphan'))).toBe(true);
    expect(data.brokenLinks.some((b) => b.raw === 'missing-page')).toBe(true);
    expect(data.counts.orphans).toBeGreaterThan(0);
    expect(data.counts.brokenLinks).toBeGreaterThan(0);
  });

  it('reports missing frontmatter and index drift', async () => {
    await writeNote(ctx.vault, 'concepts/incomplete.md', '# No frontmatter\n');
    await writeNote(
      ctx.vault,
      'index.md',
      '---\ntitle: Wiki Index\n---\n\n# Wiki Index\n\n- [[concepts/dead-entry]] — old summary\n',
    );

    const result = await callTool(ctx.server, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      missingFrontmatter: Array<{ path: string }>;
      indexDrift: { deadIndexEntries: string[]; missingFromIndex: string[] };
    };

    expect(data.missingFrontmatter.some((m) => m.path.includes('incomplete'))).toBe(true);
    expect(data.indexDrift.deadIndexEntries).toContain('concepts/dead-entry');
    expect(data.indexDrift.missingFromIndex.some((p) => p.includes('incomplete'))).toBe(true);
  });
});
