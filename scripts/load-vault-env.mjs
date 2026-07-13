#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Reads OBSIDIAN_VAULT_PATH from examples/cursor-mcp.json when not already set.
 */
function vaultPathFromExampleConfig() {
  const configPath = path.join(repoRoot, 'examples', 'cursor-mcp.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const vaultPath = parsed?.mcpServers?.cursidian?.env?.OBSIDIAN_VAULT_PATH;
  return typeof vaultPath === 'string' && vaultPath.length > 0 ? vaultPath : null;
}

/**
 * Ensures OBSIDIAN_VAULT_PATH is set for wiki/corpus MCP test scripts.
 */
function ensureVaultPath() {
  if (process.env.OBSIDIAN_VAULT_PATH) {
    return process.env.OBSIDIAN_VAULT_PATH;
  }
  const fromExample = vaultPathFromExampleConfig();
  if (fromExample) {
    process.env.OBSIDIAN_VAULT_PATH = fromExample;
    return fromExample;
  }
  console.error('[FATAL] OBSIDIAN_VAULT_PATH is not set.');
  console.error('Set the environment variable, or add it to examples/cursor-mcp.json under mcpServers.cursidian.env.');
  console.error('Example: OBSIDIAN_VAULT_PATH=/path/to/vault npm run mcp:test -- suite smoke');
  process.exit(1);
}

ensureVaultPath();

const childArgs = process.argv.slice(2);
const result = spawnSync(process.execPath, childArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
