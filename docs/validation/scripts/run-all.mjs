#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const STEPS = [
  '01-extract-corpus.mjs',
  '02-classify-patterns.mjs',
  '03-build-replay-set.mjs',
  '04-replay.mjs',
  '05-dryrun-writes.mjs',
  '06-benchmark-compare.mjs',
  '07-write-report.mjs',
];

/**
 * Runs a validation script step and streams output.
 */
function runStep(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, script)], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_PATH:
          process.env.OBSIDIAN_VAULT_PATH ??
          '/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff',
      },
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('=== MCP Real-World Validation Pipeline ===\n');
  for (const step of STEPS) {
    console.log(`\n--- ${step} ---`);
    await runStep(step);
  }
  console.log('\n=== Pipeline complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
