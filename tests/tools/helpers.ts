import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../../src/config.js';
import { setLogLevel } from '../../src/lib/logger.js';
import { clearAllSearchCaches } from '../../src/lib/vault-index.js';

export interface TestContext {
  vault: string;
  client: Client;
  config: Config;
}

export type ToolRegistrar = (server: McpServer, config: Config) => void;

async function connectClient(
  server: McpServer,
): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

export async function createTestVault(register?: ToolRegistrar): Promise<TestContext> {
  const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-test-'));
  return createTestContextAt(vault, {}, register);
}

export async function createTestContextAt(
  vaultPath: string,
  overrides: Partial<Config> = {},
  register?: ToolRegistrar,
): Promise<TestContext> {
  const config: Config = {
    vaultPath,
    readOnly: false,
    maxFileSize: 10_485_760,
    backupEnabled: false,
    logLevel: 'error',
    ...overrides,
  };
  setLogLevel(config.logLevel);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  register?.(server, config);
  const client = await connectClient(server);
  return { vault: vaultPath, client, config };
}

export async function createTestClient(
  config: Config,
  register: ToolRegistrar,
): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  register(server, config);
  return connectClient(server);
}

export async function seedVault(vault: string): Promise<void> {
  const fixturesDir = path.join(path.dirname(import.meta.dirname), 'fixtures/test-vault');
  await copyDir(fixturesDir, vault);
}

async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

export async function cleanupVault(vault: string): Promise<void> {
  await fsp.rm(vault, { recursive: true, force: true });
}

export async function writeNote(vault: string, relativePath: string, content: string): Promise<void> {
  const full = path.join(vault, relativePath);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf-8');
  clearAllSearchCaches();
}

export async function callTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await client.callTool({ name: toolName, arguments: args });
  const content = (result.content ?? []) as Array<{ type: string; text: string }>;
  return { content, isError: Boolean(result.isError) };
}

export function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}
