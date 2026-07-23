import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer, callTool, resetCaches } from '../test-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures', 'wiki-vault');

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fsp.copyFile(from, to);
    }
  }
}

function parseError(result) {
  if (!result.isError) {
    throw new Error('expected tool error');
  }
  return JSON.parse(result.content[0].text);
}

/**
 * Fixture-vault smoke suite: all four tools, structured errors, revision
 * conflicts, manifest ops, and undo. Does not touch the live vault.
 */
export async function runSmokeSuite(ctx) {
  const { runCase } = ctx;
  const results = [];
  const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-mcp-smoke-'));
  await copyDir(fixtures, vault);

  const priorVault = process.env.OBSIDIAN_VAULT_PATH;
  const priorBackup = process.env.OBSIDIAN_BACKUP_ENABLED;
  process.env.OBSIDIAN_VAULT_PATH = vault;
  process.env.OBSIDIAN_BACKUP_ENABLED = 'true';
  process.env.OBSIDIAN_LOG_LEVEL = 'error';

  resetCaches();
  const { server } = createTestServer();
  const parseResult = (result) => {
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };

  const smokePath = `_cursidian-smoke-${Date.now()}`;
  const opStack = [];
  let revisionHash;

  try {
    results.push(
      await runCase(
        'search list',
        async () => {
          const data = parseResult(await callTool(server, 'search', { action: 'list' }));
          if (!Array.isArray(data.notes)) throw new Error('missing notes');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'search recent',
        async () => {
          const data = parseResult(
            await callTool(server, 'search', { action: 'recent', limit: 5 }),
          );
          if (!Array.isArray(data.notes)) throw new Error('missing notes');
          if (!('truncated' in data)) throw new Error('missing truncated');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'note create',
        async () => {
          const data = parseResult(
            await callTool(server, 'note', {
              action: 'create',
              path: smokePath,
              content: '# Smoke test\n\nInitial body for MCP smoke test.',
              frontmatter: { tags: ['mcp-smoke'] },
            }),
          );
          if (!data.operationId) throw new Error('missing operationId');
          if (data.undoAvailable !== true) throw new Error('expected undoAvailable');
          opStack.push(data.operationId);
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'search content ranked',
        async () => {
          const data = parseResult(
            await callTool(server, 'search', { action: 'content', query: 'smoke test', limit: 5 }),
          );
          const top = data.results?.[0];
          if (!top || typeof top.relevanceScore !== 'number') {
            throw new Error('missing relevanceScore');
          }
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'search by_tags',
        async () => {
          const data = parseResult(
            await callTool(server, 'search', { action: 'by_tags', tags: ['mcp-smoke'] }),
          );
          if (!Array.isArray(data.results)) throw new Error('missing results');
          if (data.totalMatches < 1) throw new Error('expected mcp-smoke match');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'search tags',
        async () => {
          const data = parseResult(await callTool(server, 'search', { action: 'tags' }));
          if (!Array.isArray(data.tags)) throw new Error('missing tags');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'note read revisionHash',
        async () => {
          const data = parseResult(
            await callTool(server, 'note', { action: 'read', path: smokePath }),
          );
          if (!data.contentHash) throw new Error('missing contentHash');
          if (!data.revisionHash) throw new Error('missing revisionHash');
          if (!Array.isArray(data.outgoingLinks)) throw new Error('missing outgoingLinks');
          revisionHash = data.revisionHash;
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'note update expectedRevision',
        async () => {
          const data = parseResult(
            await callTool(server, 'note', {
              action: 'update',
              path: smokePath,
              mode: 'patch',
              old_string: 'Initial body',
              new_string: 'Patched body',
              expectedRevision: revisionHash,
            }),
          );
          if (!data.operationId) throw new Error('missing operationId');
          opStack.push(data.operationId);
          revisionHash = data.revisionHash ?? revisionHash;
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'revision conflict structured error',
        async () => {
          const err = parseError(
            await callTool(server, 'note', {
              action: 'update',
              path: smokePath,
              mode: 'append',
              content: '\nshould fail',
              expectedRevision: 'deadbeef',
            }),
          );
          if (err.error !== 'hash_mismatch' && err.code !== 'hash_mismatch') {
            throw new Error(`expected hash_mismatch, got ${err.error ?? err.code}`);
          }
          if (!err.recovery?.tool) throw new Error('missing recovery.tool');
          if (err.retryable !== true) throw new Error('expected retryable');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'invalid_args recovery',
        async () => {
          const err = parseError(
            await callTool(server, 'note', {
              action: 'read',
              path: smokePath,
              mode: 'patch',
            }),
          );
          if (err.error !== 'invalid_args' && err.code !== 'invalid_args') {
            throw new Error(`expected invalid_args, got ${err.error ?? err.code}`);
          }
          if (!err.recovery?.arguments) throw new Error('missing recovery.arguments');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'graph neighborhood',
        async () => {
          const data = parseResult(await callTool(server, 'graph', { path: smokePath }));
          if (!Array.isArray(data.outgoingLinks) || !Array.isArray(data.backlinks)) {
            throw new Error('missing neighborhood fields');
          }
          if (!Array.isArray(data.unresolvedOutgoingLinks)) {
            throw new Error('missing unresolvedOutgoingLinks');
          }
          if (!('truncated' in data)) throw new Error('missing truncated');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'vault health',
        async () => {
          const data = parseResult(await callTool(server, 'vault', { action: 'health' }));
          if (typeof data.counts !== 'object') throw new Error('missing counts');
          if (!('incomplete' in data)) throw new Error('missing incomplete');
          if (!Array.isArray(data.skipped)) throw new Error('missing skipped');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'vault sync_index dryRun',
        async () => {
          const data = parseResult(
            await callTool(server, 'vault', { action: 'sync_index', dryRun: true }),
          );
          if (!('wouldWrite' in data)) throw new Error('missing wouldWrite');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'vault list_folders',
        async () => {
          parseResult(await callTool(server, 'vault', { action: 'list_folders', path: '' }));
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'vault manifest upsert+read',
        async () => {
          const upserted = parseResult(
            await callTool(server, 'vault', {
              action: 'manifest',
              manifestOperation: 'upsert_source',
              sourceKey: 'C:/smoke/source.md',
              sourceIngested: new Date().toISOString(),
              sourcePages: [smokePath],
            }),
          );
          if (!upserted.operationId) throw new Error('manifest missing operationId');
          opStack.push(upserted.operationId);

          const read = parseResult(
            await callTool(server, 'vault', { action: 'manifest', manifestOperation: 'read' }),
          );
          if (!read.exists) throw new Error('manifest should exist');
          if (!read.manifest?.sources?.length) throw new Error('manifest sources empty');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'vault history',
        async () => {
          const data = parseResult(
            await callTool(server, 'vault', { action: 'history', limit: 20 }),
          );
          if (!Array.isArray(data.operations)) throw new Error('missing operations');
          if (data.operations.length < 1)
            throw new Error('expected at least one journaled operation');
        },
        ctx,
      ),
    );

    results.push(
      await runCase(
        'vault undo reverse order',
        async () => {
          while (opStack.length > 0) {
            const operationId = opStack.pop();
            const data = parseResult(
              await callTool(server, 'vault', {
                action: 'undo',
                operationId,
                confirm: true,
              }),
            );
            if (data.status === 'error') throw new Error(`undo failed for ${operationId}`);
          }
          const gone = await fsp
            .access(path.join(vault, `${smokePath}.md`))
            .then(() => false)
            .catch(() => true);
          if (!gone) {
            // create undo should remove the note; if still present, delete as last resort check failed
            throw new Error('smoke note still present after reverse-order undo');
          }
        },
        ctx,
      ),
    );
  } finally {
    if (priorVault === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
    else process.env.OBSIDIAN_VAULT_PATH = priorVault;
    if (priorBackup === undefined) delete process.env.OBSIDIAN_BACKUP_ENABLED;
    else process.env.OBSIDIAN_BACKUP_ENABLED = priorBackup;
    resetCaches();
    await fsp.rm(vault, { recursive: true, force: true }).catch(() => {});
  }

  return results;
}
