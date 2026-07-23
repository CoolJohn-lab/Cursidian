#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../../../dist/lib/frontmatter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CORPUS = path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl');
const VAULT =
  process.env.OBSIDIAN_VAULT_PATH ??
  '/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff';

const REPLACE_RATIO_THRESHOLD = 0.5;

/**
 * Mirrors assertReplaceSizeGuard from section-edit.ts without writing.
 */
function wouldSizeGuardBlock(existingBody, newBody, force = false) {
  if (force) return false;
  if (existingBody.length === 0) return false;
  const ratio = newBody.length / existingBody.length;
  return ratio < REPLACE_RATIO_THRESHOLD;
}

/**
 * Resolves a note path to an absolute file path in the vault.
 */
function resolveNotePath(notePath) {
  const cleaned = notePath.replace(/\.md$/i, '');
  return path.join(VAULT, `${cleaned}.md`);
}

/**
 * Simulates historical update_note replace calls against current file sizes.
 */
async function main() {
  const calls = (await fs.readFile(CORPUS, 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.toolName === 'update_note' && (c.arguments.mode ?? 'replace') === 'replace');

  const outcomes = [];
  let wouldBlock = 0;
  let wouldPass = 0;
  let missingFile = 0;

  for (const call of calls) {
    const notePath = call.arguments.path;
    const newContent = call.arguments.content ?? '';
    const force = call.arguments.force ?? false;
    const abs = resolveNotePath(notePath);

    let existingBody = '';
    try {
      const raw = await fs.readFile(abs, 'utf-8');
      const parsed = parseFrontmatter(raw);
      existingBody = parsed.content;
    } catch {
      missingFile += 1;
      outcomes.push({
        sessionId: call.sessionId,
        path: notePath,
        status: 'missing_file',
        wouldBlock: null,
        existingLen: null,
        newLen: newContent.length,
        ratio: null,
      });
      continue;
    }

    const blocked = wouldSizeGuardBlock(existingBody, newContent, force);
    const ratio =
      existingBody.length > 0
        ? Math.round((newContent.length / existingBody.length) * 1000) / 1000
        : null;

    if (blocked) wouldBlock += 1;
    else wouldPass += 1;

    outcomes.push({
      sessionId: call.sessionId,
      path: notePath,
      status: blocked ? 'would_block' : 'would_pass',
      wouldBlock: blocked,
      existingLen: existingBody.length,
      newLen: newContent.length,
      ratio,
      force,
    });
  }

  const blockRate =
    calls.length - missingFile > 0
      ? Math.round((wouldBlock / (calls.length - missingFile)) * 1000) / 10
      : 0;

  const output = {
    generatedAt: new Date().toISOString(),
    totalReplaceCalls: calls.length,
    wouldBlock,
    wouldPass,
    missingFile,
    blockRatePercent: blockRate,
    outcomes,
  };

  const outPath = path.join(REPO_ROOT, 'docs/validation/results/dryrun-writes.json');
  await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  console.log(`Dry-run writes: ${calls.length} replace calls`);
  console.log(
    `Would block: ${wouldBlock} (${blockRate}%), pass: ${wouldPass}, missing: ${missingFile}`,
  );
  console.log(`→ ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
