#!/usr/bin/env node
/**
 * Read-only check that ~/.cursor/mcp.json points at Cursidian (not the predecessor),
 * plus a lightweight, read-only check that the registered tool surface still includes
 * `context` (the 5th tool alongside note/search/graph/vault). Never spawns the MCP
 * server or rewrites any file - agents/humans fix config or source manually, then
 * re-run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const expectedDist = path.resolve(repoRoot, 'dist', 'index.js');
const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
const toolsIndexDist = path.resolve(repoRoot, 'dist', 'tools', 'index.js');
const toolsIndexSrc = path.resolve(repoRoot, 'src', 'tools', 'index.ts');
/** The 5-tool MCP surface this repo ships; kept in sync with src/tools/index.ts. */
const EXPECTED_TOOL_REGISTRATIONS = ['registerNote', 'registerSearch', 'registerGraph', 'registerVault', 'registerContext'];

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

/**
 * Read-only sanity check that the registered tool surface still includes every entry
 * in `expectedRegistrations` (default: the 5-tool note/search/graph/vault/context
 * surface). Scans `dist/tools/index.js` when built, falling back to
 * `src/tools/index.ts` so the check still runs before the first `npm run build`.
 * A source-text scan rather than actually starting the MCP server - full tool-schema
 * introspection would need a live server, which this script deliberately avoids.
 * Returns `{ ok, problems, skipped }`; never throws for a missing/unbuilt file.
 */
function checkToolSurface({
  distPath = toolsIndexDist,
  srcPath = toolsIndexSrc,
  expectedRegistrations = EXPECTED_TOOL_REGISTRATIONS,
} = {}) {
  const candidate = fs.existsSync(distPath) ? distPath : fs.existsSync(srcPath) ? srcPath : null;
  if (!candidate) {
    return {
      ok: true,
      problems: [],
      skipped: `neither ${path.relative(repoRoot, distPath)} nor ${path.relative(repoRoot, srcPath)} exists`,
    };
  }

  const source = fs.readFileSync(candidate, 'utf8');
  const missing = expectedRegistrations.filter((name) => !source.includes(name));
  if (missing.length > 0) {
    return {
      ok: false,
      problems: [
        `${path.relative(repoRoot, candidate)} is missing tool registration(s): ${missing.join(', ')} — the 5-tool surface (note/search/graph/vault/context) looks incomplete`,
      ],
      skipped: null,
    };
  }

  return { ok: true, problems: [], skipped: null };
}

function main() {
  if (!fs.existsSync(mcpPath)) {
    console.error(`mcp:check failed: ${mcpPath} does not exist`);
    process.exit(1);
  }

  const raw = fs.readFileSync(mcpPath, 'utf8');
  const problems = checkMcpConfig(raw, { expectedDistEntry: expectedDist });
  const toolSurface = checkToolSurface();

  if (problems.length > 0 || toolSurface.problems.length > 0) {
    console.error(`mcp:check failed (${mcpPath}):`);
    for (const problem of [...problems, ...toolSurface.problems]) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  if (toolSurface.skipped) {
    console.warn(`mcp:check: tool-surface check skipped (${toolSurface.skipped})`);
  }
  console.log(`mcp:check ok — ${mcpPath} points at cursidian (tool surface: note, search, graph, vault, context)`);
}

// Export for unit tests without running main.
export { checkMcpConfig, isAbsolutePath, checkToolSurface };

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
