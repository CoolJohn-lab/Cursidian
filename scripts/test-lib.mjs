import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from '../dist/config.js';
import { registerAllTools } from '../dist/tools/index.js';
import { clearAllSearchCaches } from '../dist/lib/vault-index.js';

/**
 * Creates an MCP server with all tools registered for script-based testing.
 */
export async function createTestServer() {
  const config = await loadConfig();
  const server = new McpServer({ name: 'mcp-test', version: '0.0.0' });
  registerAllTools(server, config);
  return { server, config };
}

/**
 * Invokes a registered MCP tool handler directly.
 */
export async function callTool(server, toolName, args = {}) {
  const registered = server._registeredTools?.[toolName];
  if (!registered?.handler) {
    throw new Error(`Tool not registered: ${toolName}`);
  }
  return registered.handler(args);
}

/**
 * Parses a successful MCP tool JSON payload.
 */
export function parseResult(result) {
  if (result.isError) {
    throw new Error(result.content[0].text);
  }
  return JSON.parse(result.content[0].text);
}

/**
 * Parses CLI args of the form --key value into an object.
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    if (next === 'true' || next === 'false') {
      args[key] = next === 'true';
    } else if (/^\d+$/.test(next)) {
      args[key] = Number(next);
    } else {
      args[key] = next;
    }
    i += 1;
  }
  return args;
}

/**
 * Runs a named test case and records pass/fail output.
 */
export async function runCase(name, fn, ctx) {
  const state = ctx.state ?? ctx;
  const started = performance.now();
  try {
    await fn();
    const ms = Math.round(performance.now() - started);
    state.passed += 1;
    console.log(`OK  ${name} (${ms}ms)`);
    return { name, ok: true, ms };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    state.failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name} (${ms}ms): ${message}`);
    return { name, ok: false, ms, error: message };
  }
}

/**
 * Clears cached vault indexes and search payloads before isolated benchmark runs.
 */
export function resetCaches() {
  clearAllSearchCaches();
}
