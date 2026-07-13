import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { registerNote } from '../../src/tools/note.js';
import { registerVault } from '../../src/tools/vault.js';
import { createTestContextAt, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContextAt(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-journal-tools-')),
    { backupEnabled: true },
    (server, config) => {
      registerNote(server, config);
      registerVault(server, config);
    },
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

type MutationPayload = {
  operationId?: string;
  undoAvailable?: boolean;
  warnings?: string[];
  revisionHash?: string;
};

async function createNote(name: string, content: string) {
  return callTool(ctx.client, 'note', { action: 'create', path: name, content });
}

describe('operation journal and undo', () => {
  it('returns operationId and undoAvailable on create', async () => {
    const result = await createNote('journal-create', '# Created');
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as MutationPayload;
    expect(data.operationId).toBeTruthy();
    expect(data.undoAvailable).toBe(true);
  });

  it('undoes create by removing the new note', async () => {
    const created = await createNote('undo-create', '# Undo me');
    const { operationId } = parseResult(created) as MutationPayload;

    const undone = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
    });
    expect(undone.isError).toBeFalsy();

    const exists = await fsp
      .access(path.join(ctx.vault, 'undo-create.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('undoes update by restoring prior content', async () => {
    await createNote('undo-update', 'version-1');
    const updated = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'undo-update',
      mode: 'replace',
      content: 'version-2',
    });
    const { operationId } = parseResult(updated) as MutationPayload;

    const undone = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
    });
    expect(undone.isError).toBeFalsy();

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'undo-update' });
    const { content } = parseResult(read) as { content: string };
    expect(content).toBe('version-1');
  });

  it('undoes delete by restoring the note', async () => {
    await createNote('undo-delete', '# restore me');
    const deleted = await callTool(ctx.client, 'note', {
      action: 'delete',
      path: 'undo-delete',
      confirm: true,
    });
    const { operationId } = parseResult(deleted) as MutationPayload;

    const undone = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
    });
    expect(undone.isError).toBeFalsy();

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'undo-delete' });
    expect(read.isError).toBeFalsy();
  });

  it('undoes frontmatter merge', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'undo-fm',
      content: '# Body',
      frontmatter: { title: 'FM', seed: 'keep' },
    });
    const merged = await callTool(ctx.client, 'note', {
      action: 'frontmatter',
      path: 'undo-fm',
      fmOperation: 'merge',
      frontmatter: { status: 'draft' },
    });
    const { operationId } = parseResult(merged) as MutationPayload;

    const undone = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
    });
    expect(undone.isError).toBeFalsy();

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'undo-fm' });
    const { frontmatter } = parseResult(read) as { frontmatter: Record<string, unknown> };
    expect(frontmatter.status).toBeUndefined();
    expect(frontmatter.seed).toBe('keep');
  });

  it('refuses undo when the file changed and force is not set', async () => {
    await createNote('undo-conflict', 'original');
    const updated = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'undo-conflict',
      mode: 'replace',
      content: 'mutated',
    });
    const { operationId } = parseResult(updated) as MutationPayload;

    await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'undo-conflict',
      mode: 'replace',
      content: 'changed-after',
    });

    const refused = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
    });
    expect(refused.isError).toBe(true);
    const payload = parseResult(refused) as { error: string };
    expect(payload.error).toBe('undo_conflict');

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'undo-conflict' });
    const { content } = parseResult(read) as { content: string };
    expect(content).toBe('changed-after');
  });

  it('allows force undo after a conflict', async () => {
    await createNote('undo-force', 'original');
    const updated = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'undo-force',
      mode: 'replace',
      content: 'mutated',
    });
    const { operationId } = parseResult(updated) as MutationPayload;

    await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'undo-force',
      mode: 'replace',
      content: 'changed-after',
    });

    const forced = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId,
      confirm: true,
      force: true,
    });
    expect(forced.isError).toBeFalsy();

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'undo-force' });
    const { content } = parseResult(read) as { content: string };
    expect(content).toBe('original');
  });

  it('lists journaled operations via history', async () => {
    await createNote('history-note', '# history');
    const history = await callTool(ctx.client, 'vault', { action: 'history', limit: 20 });
    expect(history.isError).toBeFalsy();
    const data = parseResult(history) as {
      operations: Array<{ operationId: string; paths: string[] }>;
      count: number;
    };
    expect(data.count).toBeGreaterThan(0);
    expect(data.operations[0].operationId).toBeTruthy();
  });

  it('returns undo_unavailable when backups are disabled', async () => {
    const { registerNote: regNote } = await import('../../src/tools/note.js');
    const { registerVault: regVault } = await import('../../src/tools/vault.js');
    const disabledVault = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-disabled-'));
    const disabled = await createTestContextAt(
      disabledVault,
      { backupEnabled: false },
      (server, config) => {
        regNote(server, config);
        regVault(server, config);
      },
    );

    const created = await callTool(disabled.client, 'note', {
      action: 'create',
      path: 'no-backup',
      content: 'body',
    });
    const payload = parseResult(created) as MutationPayload;
    expect(payload.undoAvailable).toBe(false);
    expect(payload.warnings?.[0]).toContain('OBSIDIAN_BACKUP_ENABLED');

    const undo = await callTool(disabled.client, 'vault', {
      action: 'undo',
      operationId: payload.operationId as string,
      confirm: true,
    });
    expect(undo.isError).toBe(true);
    expect((parseResult(undo) as { error: string }).error).toBe('not_found');

    await cleanupVault(disabledVault);
  });

  it('rejects undo for incomplete journals', async () => {
    const trashRoot = path.join(ctx.vault, '.cursidian-trash', 'incomplete-journal-test');
    await fsp.mkdir(trashRoot, { recursive: true });
    await fsp.writeFile(
      path.join(trashRoot, 'manifest.json'),
      JSON.stringify({
        operationId: 'incomplete-journal-test',
        tool: 'note',
        action: 'create',
        timestamp: new Date().toISOString(),
        undoAvailable: true,
        complete: false,
        entries: [],
      }),
      'utf-8',
    );

    const undo = await callTool(ctx.client, 'vault', {
      action: 'undo',
      operationId: 'incomplete-journal-test',
      confirm: true,
    });
    expect(undo.isError).toBe(true);
    expect((parseResult(undo) as { error: string }).error).toBe('undo_unavailable');
  });
});
