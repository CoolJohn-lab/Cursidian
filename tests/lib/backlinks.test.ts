import { describe, it, expect, afterEach } from 'vitest';
import { buildVaultIndex, clearVaultIndexCache } from '../../src/lib/vault-index.js';
import { findBacklinks } from '../../src/lib/backlinks.js';
import { createTestVault, cleanupVault, writeNote } from '../tools/helpers.js';

describe('backlinks', () => {
  afterEach(() => {
    clearVaultIndexCache();
  });

  it('finds backlinks by basename', async () => {
    const ctx = await createTestVault();
    await writeNote(
      ctx.vault,
      'concepts/old-name.md',
      '---\ntitle: Old\ncategory: concepts\ntags: [x]\nsummary: Old.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Old\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/linker.md',
      '---\ntitle: Linker\ncategory: concepts\ntags: [x]\nsummary: Links.\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nSee [[old-name]] for details.\n',
    );

    const index = await buildVaultIndex(ctx.vault);
    const backlinks = await findBacklinks(ctx.vault, 'concepts/old-name.md', index);
    expect(backlinks.some((b) => b.path.includes('linker'))).toBe(true);
    await cleanupVault(ctx.vault);
  });
});
