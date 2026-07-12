import { describe, it, expect, afterEach } from 'vitest';
import { buildVaultIndex, normaliseKey, resolveWikilinkTarget, clearVaultIndexCache } from '../../src/lib/vault-index.js';
import { createTestVault, cleanupVault, writeNote } from '../tools/helpers.js';

describe('vault-index', () => {
  afterEach(() => {
    clearVaultIndexCache();
  });

  it('indexes basename, path, and title keys', async () => {
    const ctx = await createTestVault();
    await writeNote(
      ctx.vault,
      'projects/demo/My Page.md',
      '---\ntitle: My Page Title\nsummary: demo summary\n---\n\n# Body',
    );

    const index = await buildVaultIndex(ctx.vault);
    expect(resolveWikilinkTarget('My Page', index)).toBe('projects/demo/My Page.md');
    expect(resolveWikilinkTarget('projects/demo/My Page', index)).toBe('projects/demo/My Page.md');
    expect(resolveWikilinkTarget('My Page Title', index)).toBe('projects/demo/My Page.md');
    await cleanupVault(ctx.vault);
  });

  it('normalises keys case-insensitively', () => {
    expect(normaliseKey('FactPublicHoliday.md')).toBe('factpublicholiday');
  });

  it('indexes frontmatter aliases', async () => {
    const ctx = await createTestVault();
    await writeNote(
      ctx.vault,
      'entities/dev-server-alpha.md',
      '---\ntitle: Dev Server Alpha\naliases: [compute box, dev server, alpha]\n---\n\n# Body',
    );

    const index = await buildVaultIndex(ctx.vault);
    expect(resolveWikilinkTarget('compute box', index)).toBe('entities/dev-server-alpha.md');
    expect(resolveWikilinkTarget('dev server', index)).toBe('entities/dev-server-alpha.md');
    await cleanupVault(ctx.vault);
  });
});
