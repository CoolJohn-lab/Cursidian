#!/usr/bin/env node
/**
 * Read-only check that ~/.cursor/mcp.json points at Cursidian (not the predecessor).
 * Does not rewrite the file - agents/humans fix config manually, then re-run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const expectedDist = path.resolve(repoRoot, 'dist', 'index.js');
const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');

/** Returns true when a path string is absolute (POSIX or Windows). */
function isAbsolutePath(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

/** Collects human-readable problems; empty means the config looks healthy. */
function checkMcpConfig(raw, { expectedDistEntry }) {
  const problems = [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    problems.push(`mcp.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return problems;
  }

  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object') {
    problems.push('mcp.json missing mcpServers object');
    return problems;
  }

  const cursidian = servers.cursidian;
  if (!cursidian || typeof cursidian !== 'object') {
    problems.push('mcpServers.cursidian entry is missing — config key must be "cursidian" (appears as user-cursidian)');
    return problems;
  }

  const args = Array.isArray(cursidian.args) ? cursidian.args.map(String) : [];
  const joinedArgs = args.join(' ');

  if (/Obsidian-MCP-For-Cursor/i.test(joinedArgs) || /Obsidian-MCP-For-Cursor/i.test(String(cursidian.command ?? ''))) {
    problems.push(
      'mcpServers.cursidian still references Obsidian-MCP-For-Cursor — point args at this repo dist/index.js or npx cursidian',
    );
  }

  const vaultPath = cursidian.env?.OBSIDIAN_VAULT_PATH;
  if (typeof vaultPath !== 'string' || !vaultPath.trim()) {
    problems.push('mcpServers.cursidian.env.OBSIDIAN_VAULT_PATH is missing');
  } else if (!isAbsolutePath(vaultPath.trim())) {
    problems.push(`OBSIDIAN_VAULT_PATH must be absolute (got "${vaultPath}")`);
  }

  const command = String(cursidian.command ?? '');
  if (command === 'node' || command.endsWith(`${path.sep}node`) || command === 'node.exe') {
    // Local clone launch: require the entry script to be this repo's dist/index.js when it exists.
    const entry = args.find((a) => a.endsWith(`${path.sep}index.js`) || a.endsWith('/index.js') || a.endsWith('\\index.js'));
    if (!entry) {
      problems.push('local node launch must pass dist/index.js as an arg');
    } else if (fs.existsSync(expectedDistEntry)) {
      const resolvedEntry = path.resolve(entry);
      if (resolvedEntry !== expectedDistEntry) {
        problems.push(
          `local node entry resolves to ${resolvedEntry}, expected ${expectedDistEntry}`,
        );
      }
    }
  }

  return problems;
}

function main() {
  if (!fs.existsSync(mcpPath)) {
    console.error(`mcp:check failed: ${mcpPath} does not exist`);
    process.exit(1);
  }

  const raw = fs.readFileSync(mcpPath, 'utf8');
  const problems = checkMcpConfig(raw, { expectedDistEntry: expectedDist });

  if (problems.length > 0) {
    console.error(`mcp:check failed (${mcpPath}):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  console.log(`mcp:check ok — ${mcpPath} points at cursidian`);
}

// Export for unit tests without running main.
export { checkMcpConfig, isAbsolutePath };

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
