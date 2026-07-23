#!/usr/bin/env node
/**
 * Smoke-tests all registered tools against OBSIDIAN_VAULT_PATH.
 * Uses a unique per-run note path, never overwrite:true, and always cleans up in finally.
 * Run after build: npm run build, then npm run smoke
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from '../dist/config.js';
import { registerAllTools } from '../dist/tools/index.js';
import { clearAllSearchCaches } from '../dist/lib/vault-index.js';

const server = new McpServer({ name: 'smoke', version: '0.0.0' });
const config = await loadConfig();
registerAllTools(server, config);

async function callTool(name, args) {
  const registered = server._registeredTools?.[name];
  if (!registered?.handler) {
    throw new Error(`Tool not registered: ${name}`);
  }
  return registered.handler(args);
}

function parse(result) {
  if (result.isError) {
    throw new Error(result.content[0].text);
  }
  return JSON.parse(result.content[0].text);
}

const smokePath = `_cursidian-smoke-${Date.now()}`;
let revisionHash;
let created = false;

const steps = [
  {
    name: 'search list',
    run: async () => {
      const data = parse(await callTool('search', { action: 'list' }));
      if (!Array.isArray(data.notes)) throw new Error('search list missing notes array');
    },
  },
  {
    name: 'search recent',
    run: async () => {
      const data = parse(await callTool('search', { action: 'recent', limit: 5 }));
      if (!Array.isArray(data.notes)) throw new Error('search recent missing notes array');
    },
  },
  {
    name: 'note create',
    run: async () => {
      parse(
        await callTool('note', {
          action: 'create',
          path: smokePath,
          content: '# Smoke test\n\nInitial body for MCP smoke test.',
          frontmatter: { tags: ['mcp-smoke'] },
        }),
      );
      created = true;
    },
  },
  {
    name: 'search content',
    run: async () => {
      const data = parse(
        await callTool('search', {
          action: 'content',
          query: 'smoke test',
          limit: 5,
          format: 'compact',
        }),
      );
      if (!Array.isArray(data.results)) throw new Error('search content missing results');
    },
  },
  {
    name: 'vault health',
    run: async () => {
      const data = parse(await callTool('vault', { action: 'health' }));
      if (typeof data.counts !== 'object') throw new Error('vault health missing counts');
      if (!('incomplete' in data)) throw new Error('vault health missing incomplete');
    },
  },
  {
    name: 'vault sync_index (dryRun)',
    run: async () => {
      const data = parse(await callTool('vault', { action: 'sync_index', dryRun: true }));
      if (!('wouldWrite' in data)) throw new Error('vault sync_index dryRun missing wouldWrite');
    },
  },
  {
    name: 'search by_tags',
    run: async () => {
      const data = parse(await callTool('search', { action: 'by_tags', tags: ['mcp-smoke'] }));
      if (!Array.isArray(data.results)) {
        throw new Error('search by_tags missing results array');
      }
      if (data.totalMatches < 1) {
        throw new Error('search by_tags expected at least one mcp-smoke match');
      }
    },
  },
  {
    name: 'search tags',
    run: async () => {
      const data = parse(await callTool('search', { action: 'tags' }));
      if (!Array.isArray(data.tags)) throw new Error('search tags missing tags array');
    },
  },
  {
    name: 'note read',
    run: async () => {
      const data = parse(await callTool('note', { action: 'read', path: smokePath }));
      if (!data.contentHash) throw new Error('note read missing contentHash');
      if (!data.revisionHash) throw new Error('note read missing revisionHash');
      revisionHash = data.revisionHash;
    },
  },
  {
    name: 'note update (patch)',
    run: async () => {
      const data = parse(
        await callTool('note', {
          action: 'update',
          path: smokePath,
          mode: 'patch',
          old_string: 'Initial body',
          new_string: 'Patched body',
          expectedRevision: revisionHash,
        }),
      );
      revisionHash = data.revisionHash ?? revisionHash;
    },
  },
  {
    name: 'note update (replace_section)',
    run: async () => {
      const read = parse(await callTool('note', { action: 'read', path: smokePath }));
      const data = parse(
        await callTool('note', {
          action: 'update',
          path: smokePath,
          mode: 'replace_section',
          heading: 'Smoke test',
          content: 'Section replaced by smoke test.',
          expectedRevision: read.revisionHash,
        }),
      );
      revisionHash = data.revisionHash ?? revisionHash;
    },
  },
  {
    name: 'note frontmatter',
    run: async () => {
      const read = parse(await callTool('note', { action: 'read', path: smokePath }));
      parse(
        await callTool('note', {
          action: 'frontmatter',
          path: smokePath,
          fmOperation: 'merge',
          frontmatter: { smoke: true },
          expectedRevision: read.revisionHash,
        }),
      );
    },
  },
  {
    name: 'graph',
    run: async () => {
      const data = parse(await callTool('graph', { path: smokePath }));
      if (!Array.isArray(data.backlinks)) throw new Error('graph missing backlinks');
    },
  },
  {
    name: 'vault list_folders',
    run: async () => {
      parse(await callTool('vault', { action: 'list_folders', path: '' }));
    },
  },
  {
    name: 'vault history',
    run: async () => {
      const data = parse(await callTool('vault', { action: 'history', limit: 10 }));
      if (!Array.isArray(data.operations)) throw new Error('vault history missing operations');
    },
  },
];

clearAllSearchCaches();

let failed = 0;
try {
  for (const step of steps) {
    try {
      await step.run();
      console.log(`OK  ${step.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${step.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  if (created) {
    try {
      parse(await callTool('note', { action: 'delete', path: smokePath, confirm: true }));
      console.log(`OK  note delete cleanup (${smokePath})`);
    } catch (error) {
      failed += 1;
      console.error(
        `FAIL note delete cleanup: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  clearAllSearchCaches();
}

if (failed > 0) {
  process.exit(1);
}

console.log(`\nAll smoke checks passed against ${config.vaultPath}`);
console.log(`Probe path: ${smokePath} (removed)`);
