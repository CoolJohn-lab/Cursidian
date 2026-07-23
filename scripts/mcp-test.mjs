#!/usr/bin/env node
import { createTestServer, callTool, resetCaches } from './test-lib.mjs';
import { runSmokeSuite } from './suites/smoke.mjs';

const TOOL_NAMES = ['note', 'search', 'graph', 'vault'];

const SUITES = {
  smoke: runSmokeSuite,
};

function printHelp() {
  console.log(`Usage:
  node scripts/mcp-test.mjs --list
  node scripts/mcp-test.mjs suite <name>
  node scripts/mcp-test.mjs <tool_name> [--arg value ...]

Suites: ${Object.keys(SUITES).join(', ')}

Examples:
  node scripts/mcp-test.mjs search --action content --query "wiki index" --limit 10
  node scripts/mcp-test.mjs note --action read --path index
  node scripts/mcp-test.mjs graph --path concepts/alpha
  node scripts/mcp-test.mjs vault --action health
  node scripts/mcp-test.mjs suite smoke
`);
}

async function runIsolatedTool(toolName, args) {
  const { server } = await createTestServer();
  const result = await callTool(server, toolName, args);
  if (result.isError) {
    console.error(result.content[0].text);
    process.exit(1);
  }
  console.log(result.content[0].text);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (argv[0] === '--list') {
    console.log('Tools:', TOOL_NAMES.join(', '));
    console.log('Suites:', Object.keys(SUITES).join(', '));
    return;
  }

  if (argv[0] === 'suite') {
    const suiteName = argv[1];
    const suite = SUITES[suiteName];
    if (!suite) {
      throw new Error(`Unknown suite: ${suiteName}`);
    }
    resetCaches();
    const ctx = {
      createTestServer,
      callTool,
      parseResult: (result) => {
        if (result.isError) throw new Error(result.content[0].text);
        return JSON.parse(result.content[0].text);
      },
      runCase: async (name, fn) => {
        try {
          await fn();
          console.log(`OK  ${name}`);
          return { name, ok: true };
        } catch (error) {
          console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          return { name, ok: false, error };
        }
      },
    };
    const results = await suite(ctx);
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) process.exit(1);
    return;
  }

  const toolName = argv[0];
  if (!TOOL_NAMES.includes(toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const args = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (!key || value === undefined) continue;
    const asNumber = Number(value);
    args[key] = Number.isFinite(asNumber) && String(asNumber) === value ? asNumber : value;
  }

  await runIsolatedTool(toolName, args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
