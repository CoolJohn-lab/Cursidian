#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listTranscriptFiles,
  parseTranscriptCalls,
  queryTokenOverlap,
} from './lib/parse-transcripts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_TRANSCRIPTS_DIR =
  '/Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts';
const SINCE_DATE = new Date('2026-06-08T00:00:00Z');
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl');
const CLASSIFICATION_PATH = path.join(
  REPO_ROOT,
  'docs/validation/corpus/corpus-classification.json',
);

const PLAN_BASELINE = {
  read_note: 209,
  update_note: 131,
  search_content: 87,
  manage_frontmatter: 80,
  list_notes: 45,
  create_note: 28,
  get_backlinks: 6,
  list_recent: 4,
  delete_note: 2,
  manage_folders: 1,
  get_graph: 0,
  search_by_tags: 0,
  move_note: 0,
};

/**
 * Writes one JSONL record per line for downstream replay tooling.
 */
async function writeJsonl(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(filePath, body.length > 0 ? `${body}\n` : '', 'utf-8');
}

/**
 * Tags corpus records with friction-pattern metadata used in the validation report.
 */
function classifyCorpus(records) {
  const byTranscript = new Map();
  for (const record of records) {
    if (!byTranscript.has(record.transcript_id)) byTranscript.set(record.transcript_id, []);
    byTranscript.get(record.transcript_id).push(record);
  }

  const tagged = records.map((record) => ({ ...record, friction_tags: [] }));

  for (const [, sessionRecords] of byTranscript) {
    for (let i = 0; i < sessionRecords.length; i += 1) {
      const record = sessionRecords[i];
      const taggedRecord = tagged.find(
        (r) => r.transcript_id === record.transcript_id && r.line_number === record.line_number,
      );
      if (!taggedRecord) continue;

      const mode = record.arguments?.mode ?? 'replace';
      if (record.toolName === 'update_note' && (mode === 'replace' || !record.arguments?.mode)) {
        taggedRecord.friction_tags.push('full_replace');
        const contentLen = String(record.arguments?.content ?? '').length;
        if (contentLen > 0 && contentLen < 500) {
          taggedRecord.friction_tags.push('suspected_fragment_replace');
        }
      }

      if (record.toolName === 'search_content') {
        const prevSearches = sessionRecords
          .slice(Math.max(0, i - 3), i)
          .filter((r) => r.toolName === 'search_content');
        for (const prev of prevSearches) {
          const overlap = queryTokenOverlap(
            prev.arguments?.query ?? '',
            record.arguments?.query ?? '',
          );
          if (overlap >= 0.5) {
            taggedRecord.friction_tags.push('search_retry');
            break;
          }
        }
      }

      const snippet = record.line_context?.assistant_text_snippet ?? '';
      if (/truncat|mistaken replace|restoring/i.test(snippet)) {
        taggedRecord.friction_tags.push('truncation_recovery');
      }
    }
  }

  const toolCounts = {};
  for (const record of tagged) {
    toolCounts[record.toolName] = (toolCounts[record.toolName] ?? 0) + 1;
  }

  const sessionsWithMcp = new Set(tagged.map((r) => r.transcript_id)).size;
  const replaceCount = tagged.filter(
    (r) => r.toolName === 'update_note' && (r.arguments?.mode ?? 'replace') === 'replace',
  ).length;
  const searchRetries = tagged.filter((r) => r.friction_tags.includes('search_retry')).length;
  const truncationCases = tagged.filter((r) =>
    r.friction_tags.includes('truncation_recovery'),
  ).length;

  const topSessions = [...byTranscript.entries()]
    .map(([id, recs]) => ({ transcript_id: id, mcp_calls: recs.length }))
    .sort((a, b) => b.mcp_calls - a.mcp_calls)
    .slice(0, 10);

  const reconciliation = Object.entries(PLAN_BASELINE).map(([tool, planCount]) => {
    const actual = toolCounts[tool] ?? 0;
    const deltaPct = planCount > 0 ? Math.round(((actual - planCount) / planCount) * 100) : null;
    return { tool, planCount, actual, deltaPct };
  });

  return {
    generatedAt: new Date().toISOString(),
    sinceDate: SINCE_DATE.toISOString(),
    sessionsWithMcp,
    totalCalls: tagged.length,
    toolCounts,
    replaceCount,
    searchRetries,
    truncationCases,
    topSessions,
    reconciliation,
    records: tagged,
  };
}

/**
 * Entry point: extract DLZ transcript MCP calls into validation corpus files.
 */
async function main() {
  const transcriptsDir = process.argv[2] ?? DEFAULT_TRANSCRIPTS_DIR;
  const files = await listTranscriptFiles(transcriptsDir, SINCE_DATE);
  const allRecords = [];

  for (const file of files) {
    const records = await parseTranscriptCalls(file);
    allRecords.push(...records);
  }

  const classified = classifyCorpus(allRecords);
  await writeJsonl(OUTPUT_PATH, classified.records);
  await fs.writeFile(
    CLASSIFICATION_PATH,
    `${JSON.stringify(
      {
        generatedAt: classified.generatedAt,
        sinceDate: classified.sinceDate,
        sessionsWithMcp: classified.sessionsWithMcp,
        totalCalls: classified.totalCalls,
        toolCounts: classified.toolCounts,
        replaceCount: classified.replaceCount,
        searchRetries: classified.searchRetries,
        truncationCases: classified.truncationCases,
        topSessions: classified.topSessions,
        reconciliation: classified.reconciliation,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  console.log(`Transcript files scanned: ${files.length}`);
  console.log(`MCP calls extracted: ${classified.totalCalls}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Classification: ${CLASSIFICATION_PATH}`);
  console.log('\nTool counts:');
  for (const [tool, count] of Object.entries(classified.toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: ${count}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
