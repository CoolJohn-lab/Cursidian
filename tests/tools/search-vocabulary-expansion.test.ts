import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerSearch } from '../../src/tools/search.js';
import { createTestVault, cleanupVault, callTool, parseResult, writeNote } from './helpers.js';
import type { TestContext } from './helpers.js';
import { VOCABULARY_RELATIVE_PATH } from '../../src/lib/vocabulary.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerSearch(server, config);
  });

  await writeNote(
    ctx.vault,
    VOCABULARY_RELATIVE_PATH,
    '---\npairings:\n  integration: [ingestion]\n---\n\n# Wiki Vocabulary\n',
  );

  await writeNote(
    ctx.vault,
    'concepts/ingestion-pipeline.md',
    '---\ntitle: Ingestion Pipeline\ntags: [ingestion]\nsummary: Landing zone ingestion pipeline.\n---\n\n# Ingestion Pipeline\n\nDetails about landing data.\n',
  );

  await writeNote(
    ctx.vault,
    'concepts/unrelated-topic.md',
    '---\ntitle: Unrelated Topic\n---\n\n# Unrelated Topic\n\nNothing about pipelines here.\n',
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search vocabulary expansion', () => {
  it('finds a page that only matches via a vocabulary pairing (integration -> ingestion)', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'integration',
      verbose: true,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      results: Array<{ path: string; matchReasons?: string[] }>;
    };
    const hit = data.results.find((r) => r.path.includes('ingestion-pipeline'));
    expect(hit).toBeDefined();
    expect(hit?.matchReasons?.some((r) => r.startsWith('vocab-expand:'))).toBe(true);
    expect(data.results.some((r) => r.path.includes('unrelated-topic'))).toBe(false);
  });

  it('ranks a literal match above an expansion-only match for the same query', async () => {
    await writeNote(
      ctx.vault,
      'concepts/integration-overview.md',
      '---\ntitle: Integration Overview\ntags: [integration]\nsummary: Integration overview page.\n---\n\n# Integration Overview\n\nIntegration details.\n',
    );

    const result = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'integration',
      verbose: true,
    });
    const data = parseResult(result) as {
      results: Array<{ path: string; relevanceScore: number }>;
    };
    const literal = data.results.find((r) => r.path.includes('integration-overview'));
    const expansionOnly = data.results.find((r) => r.path.includes('ingestion-pipeline'));
    expect(literal).toBeDefined();
    expect(expansionOnly).toBeDefined();
    expect(literal!.relevanceScore).toBeGreaterThan(expansionOnly!.relevanceScore);
    expect(data.results[0].path).toContain('integration-overview');
  });

  it('does not change behaviour for queries with no matching vocabulary entries', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'unrelated',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.some((r) => r.path.includes('unrelated-topic'))).toBe(true);
  });
});
