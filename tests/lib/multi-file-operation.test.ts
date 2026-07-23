import { describe, it, expect, vi, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as vaultIo from '../../src/lib/vault-io.js';
import {
  capturePathSnapshots,
  rollbackOperationSteps,
  MultiFileOperationTracker,
  runJournaledMultiFileOperation,
} from '../../src/lib/multi-file-operation.js';
import { PartialUpdateError } from '../../src/lib/vault-io.js';

describe('multi-file-operation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores written files when rolling back steps', async () => {
    const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-mf-op-'));
    const notePath = path.join(vault, 'note.md');
    await fsp.writeFile(notePath, 'before\n', 'utf-8');

    const snapshots = await capturePathSnapshots(vault, [notePath], 1024);
    const tracker = new MultiFileOperationTracker();
    tracker.recordWrite('note.md');
    await fsp.writeFile(notePath, 'after\n', 'utf-8');

    const { restored, unresolved } = await rollbackOperationSteps(
      vault,
      snapshots,
      tracker.getSteps(),
      1024,
    );

    expect(restored).toEqual(['note.md']);
    expect(unresolved).toEqual([]);
    expect(await fsp.readFile(notePath, 'utf-8')).toBe('before\n');
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it('reports unresolved paths when restore fails', async () => {
    const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-mf-op-'));
    const notePath = path.join(vault, 'note.md');
    await fsp.writeFile(notePath, 'before\n', 'utf-8');

    const snapshots = await capturePathSnapshots(vault, [notePath], 1024);
    const tracker = new MultiFileOperationTracker();
    tracker.recordWrite('note.md');
    await fsp.writeFile(notePath, 'after\n', 'utf-8');

    const original = vaultIo.atomicReplaceLocked;
    vi.spyOn(vaultIo, 'atomicReplaceLocked').mockRejectedValue(new Error('restore failed'));

    const { restored, unresolved } = await rollbackOperationSteps(
      vault,
      snapshots,
      tracker.getSteps(),
      1024,
    );

    vi.mocked(vaultIo.atomicReplaceLocked).mockImplementation(original);
    expect(restored).toEqual([]);
    expect(unresolved).toEqual(['note.md']);
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it('throws PartialUpdateError when journaled operation rollback is incomplete', async () => {
    const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-mf-op-'));
    const notePath = path.join(vault, 'note.md');
    await fsp.writeFile(notePath, 'before\n', 'utf-8');

    const original = vaultIo.atomicReplaceLocked;
    let calls = 0;
    vi.spyOn(vaultIo, 'atomicReplaceLocked').mockImplementation(
      async (vaultPath, targetPath, body, maxBytes) => {
        calls += 1;
        if (calls >= 2) {
          throw new Error('restore failed');
        }
        return original(vaultPath, targetPath, body, maxBytes);
      },
    );

    await expect(
      runJournaledMultiFileOperation(
        { vaultPath: vault, backupEnabled: false, maxFileSize: 1024 },
        {
          tool: 'note',
          action: 'update',
          lockPaths: [notePath],
          snapshotPaths: [notePath],
          run: async ({ tracker }) => {
            await vaultIo.atomicReplaceLocked(vault, notePath, 'after\n', 1024);
            tracker.recordWrite('note.md');
            throw new Error('write failed');
          },
        },
      ),
    ).rejects.toBeInstanceOf(PartialUpdateError);

    await fsp.rm(vault, { recursive: true, force: true });
  });

  it('PartialUpdateError carries completed, restored, and unresolved arrays', () => {
    const error = new PartialUpdateError('failed', ['a.md'], ['a.md'], ['b.md']);
    expect(error.completed).toEqual(['a.md']);
    expect(error.restored).toEqual(['a.md']);
    expect(error.unresolved).toEqual(['b.md']);
    expect(error.failed).toEqual(['b.md']);
  });
});
