import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { registerVault } from '../../src/tools/vault.js';
import { registerNote } from '../../src/tools/note.js';
import { createTestContextAt, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';
import { MANIFEST_RELATIVE_PATH } from '../../src/lib/manifest.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContextAt(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-manifest-')),
    { backupEnabled: true },
    (server, config) => {
      registerNote(server, config);
      registerVault(server, config);
    },
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

type ManifestPayload = {
  exists?: boolean;
  revisionHash?: string;
  manifest?: {
    sourceDirs: string[];
    sources: Array<{ key: string; ingested: string; mtime?: string; pages?: string[] }>;
    projects: Array<{ name: string; cwd: string; lastCommit?: string; synced?: string }>;
  };
  operationId?: string;
  undoAvailable?: boolean;
  error?: string;
};

async function readManifest() {
  return callTool(ctx.client, 'vault', { action: 'manifest', manifestOperation: 'read' });
}

describe('vault manifest action', () => {
  it('read on missing manifest returns empty record', async () => {
    const result = await readManifest();
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ManifestPayload;
    expect(data.exists).toBe(false);
    expect(data.manifest?.sources).toEqual([]);
    expect(data.manifest?.projects).toEqual([]);
  });

  it('creates manifest on first upsert_source', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_source',
      sourceKey: 'C:\\sources\\paper.pdf',
      sourceIngested: '2026-07-12T16:00:00Z',
      sourceMtime: '2026-07-10T09:00:00Z',
      sourcePages: ['concepts/foo'],
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ManifestPayload;
    expect(data.manifest?.sources[0]?.key).toBe('C:/sources/paper.pdf');
    expect(data.revisionHash).toBeTruthy();
    expect(data.operationId).toBeTruthy();
    expect(data.undoAvailable).toBe(true);

    const onDisk = await fsp.readFile(path.join(ctx.vault, MANIFEST_RELATIVE_PATH), 'utf-8');
    expect(onDisk).toContain('C:/sources/paper.pdf');
    expect(onDisk).toContain('[[concepts/foo]]');
  });

  it('upserts project records', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_project',
      projectName: 'demo',
      projectCwd: 'C:/projects/demo',
      projectLastCommit: 'abc123f',
      projectSynced: '2026-07-12T16:00:00Z',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ManifestPayload;
    expect(data.manifest?.projects[0]).toMatchObject({
      name: 'demo',
      cwd: 'C:/projects/demo',
      lastCommit: 'abc123f',
    });
  });

  it('replaces duplicate source on upsert', async () => {
    const read = await readManifest();
    const { revisionHash } = parseResult(read) as ManifestPayload;

    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_source',
      sourceKey: 'c:/sources/paper.pdf',
      sourceIngested: '2026-07-12T18:00:00Z',
      expectedRevision: revisionHash,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ManifestPayload;
    expect(data.manifest?.sources.filter((s) => s.key.toLowerCase() === 'c:/sources/paper.pdf')).toHaveLength(1);
    expect(data.manifest?.sources[0]?.ingested).toBe('2026-07-12T18:00:00Z');
  });

  it('rejects stale expectedRevision', async () => {
    const read = await readManifest();
    const { revisionHash } = parseResult(read) as ManifestPayload;

    await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_source',
      sourceKey: 'C:/sources/other.pdf',
      sourceIngested: '2026-07-12T19:00:00Z',
    });

    const stale = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_source',
      sourceKey: 'C:/sources/third.pdf',
      sourceIngested: '2026-07-12T20:00:00Z',
      expectedRevision: revisionHash,
    });
    expect(stale.isError).toBe(true);
    const data = parseResult(stale) as ManifestPayload;
    expect(data.error).toBe('hash_mismatch');
  });

  it('removes a source entry', async () => {
    const read = await readManifest();
    const { revisionHash } = parseResult(read) as ManifestPayload;

    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'remove',
      removeKind: 'source',
      removeKey: 'C:/sources/other.pdf',
      expectedRevision: revisionHash,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as ManifestPayload;
    expect(data.manifest?.sources.some((s) => s.key.includes('other.pdf'))).toBe(false);
  });

  it('undoes manifest write', async () => {
    const before = await readManifest();
    const beforeData = parseResult(before) as ManifestPayload;
    const countBefore = beforeData.manifest?.sources.length ?? 0;

    const write = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_source',
      sourceKey: 'C:/sources/undo-me.pdf',
      sourceIngested: '2026-07-12T21:00:00Z',
    });
    const { operationId } = parseResult(write) as ManifestPayload;

    const undone = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
    });
    expect(undone.isError).toBeFalsy();

    const after = await readManifest();
    const afterData = parseResult(after) as ManifestPayload;
    expect(afterData.manifest?.sources.length).toBe(countBefore);
    expect(afterData.manifest?.sources.some((s) => s.key.includes('undo-me.pdf'))).toBe(false);
  });

  it('preserves unknown markdown sections across writes', async () => {
    const manifestPath = path.join(ctx.vault, MANIFEST_RELATIVE_PATH);
    const existing = await fsp.readFile(manifestPath, 'utf-8');
    const withCustom = `${existing.trimEnd()}\n\n## Audit Trail\n\n- manual note\n`;
    await fsp.writeFile(manifestPath, withCustom, 'utf-8');

    const read = await readManifest();
    const { revisionHash } = parseResult(read) as ManifestPayload;

    await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_project',
      projectName: 'audit-project',
      projectCwd: 'C:/audit',
      expectedRevision: revisionHash,
    });

    const finalRaw = await fsp.readFile(manifestPath, 'utf-8');
    expect(finalRaw).toContain('## Audit Trail');
    expect(finalRaw).toContain('- manual note');
  });
});

describe('vault manifest validation', () => {
  it('rejects upsert_source without sourceIngested', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'upsert_source',
      sourceKey: 'C:/missing-ingested.pdf',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; details?: { missing?: string[] } };
    expect(data.error).toBe('invalid_args');
    expect(data.details?.missing).toContain('sourceIngested');
  });

  it('rejects unrelated arguments on manifest read', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'read',
      sourceKey: 'should-not-apply',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { details?: { rejected?: string[] } };
    expect(data.details?.rejected).toContain('sourceKey');
  });
});
