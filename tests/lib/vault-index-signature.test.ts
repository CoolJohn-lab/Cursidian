import { describe, it, expect, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildVaultIndex, clearVaultIndexCache, getVaultIndex } from '../../src/lib/vault-index.js';
import { createTestVault, cleanupVault, writeNote } from '../tools/helpers.js';

describe('vault-index signature invalidation', () => {
  afterEach(() => {
    clearVaultIndexCache();
  });

  it('rebuilds the index when a note changes on disk within the TTL window', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'note.md', '---\ntitle: Original\ntags: [alpha]\n---\n\n# Original');

    const first = await getVaultIndex(ctx.vault);
    expect([...first.values()][0]?.tags).toContain('alpha');

    // In-place edit without clearAllSearchCaches - signature must bust the TTL cache.
    await writeNote(ctx.vault, 'note.md', '---\ntitle: Updated\ntags: [beta]\n---\n\n# Updated');
    // Ensure mtime advances on filesystems with coarse timestamps.
    const full = path.join(ctx.vault, 'note.md');
    const now = new Date(Date.now() + 2000);
    await fsp.utimes(full, now, now);

    const second = await getVaultIndex(ctx.vault);
    const entry = [...second.values()].find((e) => e.path === 'note.md' || e.basename === 'note');
    expect(entry?.tags).toContain('beta');
    expect(entry?.title).toBe('Updated');

    await cleanupVault(ctx.vault);
  });

  it('registers generic project aliases', async () => {
    const ctx = await createTestVault();
    await writeNote(
      ctx.vault,
      'projects/demo/concepts/widget.md',
      '---\ntitle: Widget\n---\n\n# Widget',
    );
    const index = await buildVaultIndex(ctx.vault);
    expect(index.get('concepts/widget')?.path).toBe('projects/demo/concepts/widget.md');
    expect(index.get('widget')?.path).toBe('projects/demo/concepts/widget.md');
    await cleanupVault(ctx.vault);
  });
});
