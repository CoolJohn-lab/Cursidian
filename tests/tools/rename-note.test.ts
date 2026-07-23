import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerNote } from '../../src/tools/note.js';
import { buildVaultIndex } from '../../src/lib/vault-index.js';
import { findBacklinks } from '../../src/lib/backlinks.js';
import { createTestVault, cleanupVault, callTool, parseResult, writeNote } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerNote(server, config);
  });
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note (rename)', () => {
  it('moves a note and rewrites backlinks', async () => {
    await writeNote(
      ctx.vault,
      'concepts/old-name.md',
      '---\ntitle: Old Name\ncategory: concepts\ntags: [x]\nsummary: Old.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Old\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/linker.md',
      '---\ntitle: Linker\ncategory: concepts\ntags: [x]\nsummary: Links.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nSee [[old-name]] for details.\n',
    );
    await writeNote(
      ctx.vault,
      'index.md',
      '---\ntitle: Wiki Index\n---\n\n# Wiki Index\n\n- [[concepts/old-name]] - Old.\n',
    );

    const index = await buildVaultIndex(ctx.vault);
    const before = await findBacklinks(
      ctx.vault,
      'concepts/old-name.md',
      index,
      ctx.config.maxFileSize,
    );
    expect(before.some((b) => b.path.includes('linker'))).toBe(true);

    const result = await callTool(ctx.client, 'note', {
      action: 'rename',
      path: 'concepts/old-name',
      newPath: 'concepts/new-name',
      updateBacklinks: true,
      updateIndex: true,
    });
    const data = parseResult(result) as {
      from: string;
      to: string;
      backlinksUpdated: number;
      indexUpdated: boolean;
    };

    expect(data.to).toContain('new-name');
    expect(data.backlinksUpdated).toBeGreaterThan(0);

    await expect(fs.access(path.join(ctx.vault, 'concepts/new-name.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(ctx.vault, 'concepts/old-name.md'))).rejects.toThrow();

    const linker = await fs.readFile(path.join(ctx.vault, 'concepts/linker.md'), 'utf-8');
    expect(linker).toContain('[[new-name]]');

    const indexContent = await fs.readFile(path.join(ctx.vault, 'index.md'), 'utf-8');
    expect(indexContent).toContain('[[concepts/new-name]]');
    expect(data.indexUpdated).toBe(true);
  });

  it('rewrites embeds and anchored links on rename', async () => {
    await writeNote(
      ctx.vault,
      'concepts/anchor-src.md',
      '---\ntitle: Anchor Src\ncategory: concepts\ntags: [x]\nsummary: Src.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Src\n\n^block1\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/anchor-linker.md',
      '---\ntitle: Anchor Linker\ncategory: concepts\ntags: [x]\nsummary: Linker.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n![[anchor-src]]\n[[anchor-src#Src]]\n[[anchor-src#^block1]]\n',
    );

    const result = await callTool(ctx.client, 'note', {
      action: 'rename',
      path: 'concepts/anchor-src',
      newPath: 'concepts/anchor-dst',
      updateBacklinks: true,
      updateIndex: false,
    });
    expect(result.isError).toBeFalsy();

    const linker = await fs.readFile(path.join(ctx.vault, 'concepts/anchor-linker.md'), 'utf-8');
    expect(linker).toContain('![[anchor-dst]]');
    expect(linker).toContain('[[anchor-dst#Src]]');
    expect(linker).toContain('[[anchor-dst#^block1]]');
  });
});
