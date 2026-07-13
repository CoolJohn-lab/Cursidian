import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { clearRealVaultCache, listVaultMarkdownPaths } from '../../src/lib/vault-glob.js';

describe('vaultGlob symlink containment', () => {
  let root = '';
  let vault = '';
  let outside = '';
  let outsideNote = '';
  let symlinkOk = false;

  beforeAll(async () => {
    clearRealVaultCache();
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-vault-glob-'));
    vault = path.join(root, 'vault');
    outside = path.join(root, 'outside');
    outsideNote = path.join(outside, 'secret.md');
    await fsp.mkdir(vault, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
    await fsp.writeFile(path.join(vault, 'inside.md'), '# inside');
    await fsp.writeFile(outsideNote, '# outside secret');

    const escapeLink = path.join(vault, 'escape');
    try {
      if (process.platform === 'win32') {
        await fsp.symlink(outside, escapeLink, 'junction');
      } else {
        await fsp.symlink(outside, escapeLink, 'dir');
      }
      symlinkOk = true;
    } catch (err) {
      symlinkOk = false;
      if (process.platform !== 'win32') {
        throw new Error(
          `Symlink fixture required on ${process.platform} but creation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  afterAll(async () => {
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('excludes markdown reached through a symlinked directory outside the vault', async (ctx) => {
    if (!symlinkOk) {
      ctx.skip();
    }
    const paths = await listVaultMarkdownPaths(vault);
    const basenames = paths.map((p) => path.basename(p));
    expect(basenames).toContain('inside.md');
    expect(basenames).not.toContain('secret.md');
    expect(paths.some((p) => p.includes('escape'))).toBe(false);
  });
});
