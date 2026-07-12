import { describe, it, expect } from 'vitest';
import {
  wikilinkTargetsNote,
  resolveOutgoingLinks,
} from '../../src/lib/wikilink-resolve.js';
import {
  buildVaultIndex,
  resolveWikilinkTarget,
  stripWikilinkAnchor,
} from '../../src/lib/vault-index.js';
import { createTestVault, cleanupVault, writeNote } from '../tools/helpers.js';

describe('wikilink-resolve', () => {
  it('matches backlinks by title alias', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'projects/demo/hub.md', '---\ntitle: Project Hub\n---\n\n# Hub');
    await writeNote(
      ctx.vault,
      'projects/demo/child.md',
      '---\ntitle: Child\n---\n\nSee [[Project Hub]] for context',
    );

    const index = await buildVaultIndex(ctx.vault);
    expect(wikilinkTargetsNote('Project Hub', 'projects/demo/hub.md', index)).toBe(true);
    await cleanupVault(ctx.vault);
  });

  it('resolves outgoing path links', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'projects/demo/target.md', '---\ntitle: Target\n---\n\n# Target');
    await writeNote(
      ctx.vault,
      'index.md',
      '---\ntitle: Index\n---\n\nLink [[projects/demo/target]]',
    );

    const index = await buildVaultIndex(ctx.vault);
    const links = resolveOutgoingLinks('Link [[projects/demo/target]]', index);
    expect(links[0].resolvedPath).toBe('projects/demo/target.md');
    await cleanupVault(ctx.vault);
  });

  it('resolves wikilinks with heading anchors', async () => {
    const ctx = await createTestVault();
    await writeNote(ctx.vault, 'projects/demo/target.md', '---\ntitle: Target\n---\n\n# Target');
    await writeNote(
      ctx.vault,
      'projects/demo/source.md',
      '---\ntitle: Source\n---\n\nSee [[projects/demo/target#Section heading]]',
    );

    const index = await buildVaultIndex(ctx.vault);
    expect(stripWikilinkAnchor('projects/demo/target#Section heading')).toBe('projects/demo/target');
    expect(resolveWikilinkTarget('projects/demo/target#Section heading', index)).toBe(
      'projects/demo/target.md',
    );
    const links = resolveOutgoingLinks(
      'See [[projects/demo/target#Section heading]]',
      index,
    );
    expect(links[0].resolvedPath).toBe('projects/demo/target.md');
    await cleanupVault(ctx.vault);
  });

  it('resolves project-relative concept paths via generic aliases', async () => {
    const ctx = await createTestVault();
    await writeNote(
      ctx.vault,
      'projects/my-project/concepts/widget.md',
      '---\ntitle: Widget\n---\n\n# Widget',
    );
    await writeNote(
      ctx.vault,
      'projects/my-project/hub.md',
      '---\ntitle: Hub\n---\n\n[[concepts/widget]]',
    );

    const index = await buildVaultIndex(ctx.vault);
    const links = resolveOutgoingLinks('[[concepts/widget]]', index);
    expect(links[0].resolvedPath).toBe('projects/my-project/concepts/widget.md');
    expect(resolveWikilinkTarget('widget', index)).toBe('projects/my-project/concepts/widget.md');
    await cleanupVault(ctx.vault);
  });
});
