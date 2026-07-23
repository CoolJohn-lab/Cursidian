#!/usr/bin/env node
/**
 * Post-build MCP smoke: spawns dist/index.js and exercises all four consolidated tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const entry = path.join(repoRoot, 'dist', 'index.js');
const fixtures = path.join(repoRoot, 'tests', 'fixtures', 'wiki-vault');

async function main() {
  if (!fs.existsSync(entry)) {
    console.error(`Build output missing: ${entry}`);
    process.exit(1);
  }

  const vault = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cursidian-mcp-int-'));
  await copyDir(fixtures, vault);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      OBSIDIAN_VAULT_PATH: vault,
      OBSIDIAN_LOG_LEVEL: 'error',
      OBSIDIAN_BACKUP_ENABLED: 'false',
    },
  });

  const client = new Client({ name: 'cursidian-integration', version: '0' });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  const expected = ['graph', 'note', 'search', 'vault'];
  for (const name of expected) {
    if (!names.includes(name)) {
      throw new Error(`Missing tool ${name}; got ${names.join(', ')}`);
    }
  }

  const read = await client.callTool({
    name: 'note',
    arguments: { action: 'read', path: 'concepts/alpha' },
  });
  if (read.isError) {
    throw new Error(`note read failed: ${JSON.stringify(read.content)}`);
  }

  const search = await client.callTool({
    name: 'search',
    arguments: { action: 'content', query: 'Alpha', limit: 5 },
  });
  if (search.isError) {
    throw new Error(`search failed: ${JSON.stringify(search.content)}`);
  }

  const graph = await client.callTool({
    name: 'graph',
    arguments: { path: 'concepts/alpha' },
  });
  if (graph.isError) {
    throw new Error(`graph failed: ${JSON.stringify(graph.content)}`);
  }

  const health = await client.callTool({
    name: 'vault',
    arguments: { action: 'health' },
  });
  if (health.isError) {
    throw new Error(`vault health failed: ${JSON.stringify(health.content)}`);
  }

  await client.close();
  await fs.promises.rm(vault, { recursive: true, force: true });
  console.error('MCP integration: all four tools responded OK');
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.promises.copyFile(from, to);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
