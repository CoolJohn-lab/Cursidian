import { describe, it, expect, afterEach } from 'vitest';
import {
  buildVaultIndex,
  normaliseKey,
  resolveWikilinkTarget,
  resolveExistingNotePath,
  getIndexKeyCollisions,
  PathResolveError,
  clearVaultIndexCache,
} from '../../src/lib/vault-index.js';
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

  it('treats colliding aliases as unresolved for wikilinks and throws for path resolve', async () => {
    const ctx = await createTestVault();
    await writeNote(
      ctx.vault,
      'entities/one.md',
      '---\ntitle: One\naliases: [shared-alias]\n---\n\n# One\n',
    );
    await writeNote(
      ctx.vault,
      'entities/two.md',
      '---\ntitle: Two\naliases: [shared-alias]\n---\n\n# Two\n',
    );

    const index = await buildVaultIndex(ctx.vault);
    const collisions = getIndexKeyCollisions(index);
    expect(collisions.get('shared-alias')).toEqual(['entities/one.md', 'entities/two.md']);
    expect(resolveWikilinkTarget('shared-alias', index)).toBeNull();

    await expect(resolveExistingNotePath(ctx.vault, 'shared-alias')).rejects.toBeInstanceOf(
      PathResolveError,
    );
    try {
      await resolveExistingNotePath(ctx.vault, 'shared-alias');
    } catch (e) {
      expect(e).toBeInstanceOf(PathResolveError);
      expect((e as PathResolveError).paths).toEqual(['entities/one.md', 'entities/two.md']);
      expect((e as PathResolveError).code).toBe('invalid_args');
    }

    await cleanupVault(ctx.vault);
  });

  it('resolves a hyphenated basename via space-to-hyphen slug fallback', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'entities/dev-server-alpha.md', '# Dev Server Alpha\n\nNo frontmatter title.');

    const index = await buildVaultIndex(ctx.vault);
    expect(resolveWikilinkTarget('Dev Server Alpha', index)).toBe('entities/dev-server-alpha.md');
    await cleanupVault(ctx.vault);
  });

  it('resolves a nested path suffix via endsWith fallback', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'entities/legacy/dev-server-beta.md', '# Dev Server Beta');

    const index = await buildVaultIndex(ctx.vault);
    expect(resolveWikilinkTarget('legacy/dev-server-beta', index)).toBe(
      'entities/legacy/dev-server-beta.md',
    );
    await cleanupVault(ctx.vault);
  });

  it('returns null for an ambiguous nested-path suffix match', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'entities/legacy/dev-server-gamma.md', '# Gamma One');
    await writeNote(ctx.vault, 'archive/legacy/dev-server-gamma.md', '# Gamma Two');

    const index = await buildVaultIndex(ctx.vault);
    expect(resolveWikilinkTarget('legacy/dev-server-gamma', index)).toBeNull();
    await cleanupVault(ctx.vault);
  });
});
