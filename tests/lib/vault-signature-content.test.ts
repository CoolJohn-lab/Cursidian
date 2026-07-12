import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildVaultMarkdownSignature } from '../../src/lib/vault-signature.js';

describe('buildVaultMarkdownSignature', () => {
  it('detects same-size content changes when mtime is preserved', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-signature-'));
    const note = path.join(dir, 'note.md');
    try {
      await fsp.writeFile(note, '# alpha\n', 'utf-8');
      const stat = await fsp.stat(note);
      const first = await buildVaultMarkdownSignature([note]);

      await fsp.writeFile(note, '# beta!\n', 'utf-8');
      await fsp.utimes(note, stat.atime, stat.mtime);

      const second = await buildVaultMarkdownSignature([note]);
      expect(second).not.toBe(first);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
