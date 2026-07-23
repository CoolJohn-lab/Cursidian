import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as vaultIo from '../../src/lib/vault-io.js';
import { registerNote } from '../../src/tools/note.js';
import { registerVault } from '../../src/tools/vault.js';
import {
  createTestContextAt,
  cleanupVault,
  callTool,
  writeNote,
} from './helpers.js';
import type { TestContext } from './helpers.js';

async function readVaultFiles(vault: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  async function walk(dir: string, prefix = ''): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.cursidian-trash') {
        continue;
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else {
        files.set(rel.replace(/\\/g, '/'), await fs.readFile(abs, 'utf-8'));
      }
    }
  }

  await walk(vault);
  return files;
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}

describe('multi-file rollback', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContextAt(
      await fs.mkdtemp(path.join(os.tmpdir(), 'cursidian-multi-file-')),
      { backupEnabled: true },
      (server, config) => {
        registerNote(server, config);
        registerVault(server, config);
      },
    );

    await writeNote(
      ctx.vault,
      'concepts/source.md',
      '---\ntitle: Source\ncategory: concepts\nsummary: Source note.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Source\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/linker.md',
      '---\ntitle: Linker\ncategory: concepts\nsummary: Linker.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nSee [[concepts/source]] here.\n',
    );
    await writeNote(
      ctx.vault,
      'index.md',
      '---\ntitle: Wiki Index\n---\n\n# Wiki Index\n\n- [[concepts/source]] - Source note.\n',
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (ctx) {
      await cleanupVault(ctx.vault);
    }
  });

  it('rolls back rename when fs.rename fails', async () => {
    const before = await readVaultFiles(ctx.vault);
    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));

    const result = await callTool(ctx.client, 'note', {
      action: 'rename',
      path: 'concepts/source',
      newPath: 'concepts/dest',
      updateBacklinks: true,
      updateIndex: true,
    });

    renameSpy.mockRestore();
    expect(result.isError).toBe(true);

    const after = await readVaultFiles(ctx.vault);
    expect(mapsEqual(before, after)).toBe(true);
  });

  it('rolls back sync_index when index write fails', async () => {
    const before = await readVaultFiles(ctx.vault);
    const writeSpy = vi
      .spyOn(vaultIo, 'atomicWriteLocked')
      .mockRejectedValueOnce(new Error('index write failed'));

    const result = await callTool(ctx.client, 'vault', { action: 'sync_index' });
    writeSpy.mockRestore();
    expect(result.isError).toBe(true);

    const after = await readVaultFiles(ctx.vault);
    expect(mapsEqual(before, after)).toBe(true);
  });
});
