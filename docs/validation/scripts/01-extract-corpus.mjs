#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCorpus } from './lib/transcript-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TRANSCRIPTS_ROOT =
  process.env.DLZ_TRANSCRIPTS_ROOT ??
  path.join(
    process.env.HOME,
    '.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts',
  );
const SINCE = new Date('2026-06-08T00:00:00.000Z');
const OUT = path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl');

async function main() {
  console.log(`Extracting MCP calls from ${TRANSCRIPTS_ROOT}`);
  console.log(`Window: ${SINCE.toISOString()} → now`);

  const calls = await extractCorpus(TRANSCRIPTS_ROOT, SINCE);
  await fs.mkdir(path.dirname(OUT), { recursive: true });

  const lines = calls.map((c) => JSON.stringify(c));
  await fs.writeFile(OUT, `${lines.join('\n')}\n`, 'utf-8');

  const byTool = {};
  const bySession = new Set();
  for (const call of calls) {
    byTool[call.toolName] = (byTool[call.toolName] ?? 0) + 1;
    bySession.add(call.sessionId);
  }

  console.log(`Wrote ${calls.length} calls from ${bySession.size} sessions → ${OUT}`);
  console.log('By tool:', JSON.stringify(byTool, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
