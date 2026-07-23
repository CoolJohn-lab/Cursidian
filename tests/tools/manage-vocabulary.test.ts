import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerSearch } from '../../src/tools/search.js';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, writeNote, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';
import { VOCABULARY_RELATIVE_PATH } from '../../src/lib/vocabulary.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerSearch(server, config);
    registerVault(server, config);
  });
  await writeNote(
    ctx.vault,
    'concepts/ingestion-pipeline.md',
    `---
title: Ingestion Pipeline
summary: How inbound sources land in bronze.
tags: [ingestion, pipeline]
---

# Ingestion Pipeline

Inbound source pulls land in bronze via ADF.
`,
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('vault vocabulary + search expansion', () => {
  it('reads empty vocabulary when the file is missing', async () => {
    const read = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'read',
    });
    expect(read.isError).toBeFalsy();
    const data = parseResult(read) as { exists: boolean; vocabulary: { synonyms: unknown[] } };
    expect(data.exists).toBe(false);
    expect(data.vocabulary.synonyms).toEqual([]);
  });

  it('rejects upsert without synonymGroup or pairing', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'upsert',
    });
    expect(result.isError).toBe(true);
  });

  it('upserts synonym groups and pairings, then expands search', async () => {
    const synonym = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'upsert',
      synonymGroup: ['ingestion', 'ingest', 'inbound source'],
    });
    expect(synonym.isError).toBeFalsy();

    const pairing = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'upsert',
      pairingKey: 'integration',
      pairingValues: ['ingestion', 'egress'],
    });
    expect(pairing.isError).toBeFalsy();
    const upsertData = parseResult(pairing) as { path: string };
    expect(upsertData.path).toBe(VOCABULARY_RELATIVE_PATH);

    const read = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'read',
    });
    const readData = parseResult(read) as {
      exists: boolean;
      vocabulary: { synonyms: string[][]; pairings: Record<string, string[]> };
    };
    expect(readData.exists).toBe(true);
    expect(readData.vocabulary.pairings.integration).toEqual(
      expect.arrayContaining(['ingestion', 'egress']),
    );

    const search = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'integration',
      format: 'compact',
      limit: 10,
    });
    expect(search.isError).toBeFalsy();
    const searchData = parseResult(search) as { results: Array<{ path: string }> };
    expect(searchData.results.some((r) => r.path.includes('ingestion'))).toBe(true);
  });

  it('removes synonym groups and pairings', async () => {
    const removeSyn = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'remove',
      removeKind: 'synonym',
      removeKey: 'ingest',
    });
    expect(removeSyn.isError).toBeFalsy();

    const removePair = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'remove',
      removeKind: 'pairing',
      removeKey: 'integration',
    });
    expect(removePair.isError).toBeFalsy();

    const read = await callTool(ctx.client, 'vault', {
      action: 'vocabulary',
      vocabularyOperation: 'read',
    });
    const data = parseResult(read) as {
      vocabulary: { synonyms: string[][]; pairings: Record<string, string[]> };
    };
    expect(data.vocabulary.pairings.integration).toBeUndefined();
  });
});
