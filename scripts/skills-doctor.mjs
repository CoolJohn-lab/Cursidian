#!/usr/bin/env node
/**
 * Detects a stale ~/.cursor/skills/ install relative to skills/wiki/ in this repo.
 *
 * Compares a content fingerprint (recursive file list + hash) per skill folder,
 * not just mtimes - mtimes survive `git checkout`/`git pull` in ways that don't
 * reflect real content drift, so a hash mismatch is the trustworthy signal.
 *
 * Usage:
 *   node scripts/skills-doctor.mjs
 *   node scripts/skills-doctor.mjs --dest "C:\\custom\\skills"
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SKILL_NAMES = [
  'llm-wiki',
  'wiki-query',
  'wiki-context',
  'wiki-lint',
  'wiki-setup',
  'wiki-ingest',
  'wiki-capture',
  'wiki-update',
  'wiki-status',
  'wiki-slop',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'skills', 'wiki');

function parseArgs(argv) {
  let dest = path.join(os.homedir(), '.cursor', 'skills');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dest') {
      dest = argv[++i];
      if (!dest) {
        console.error('Error: --dest requires a path');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/skills-doctor.mjs [--dest <path>]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return { dest };
}

function collectFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else {
      files.push(full);
    }
  }
  return files.sort();
}

/** Order-independent content hash: relative path + bytes, per file, sorted. */
function fingerprint(root) {
  if (!fs.existsSync(root)) {
    return null;
  }
  const hash = crypto.createHash('sha256');
  for (const file of collectFiles(root)) {
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function main() {
  const { dest } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(srcRoot)) {
    console.error(`Source skills not found: ${srcRoot}`);
    process.exit(1);
  }

  console.log(`Source: ${srcRoot}`);
  console.log(`Dest:   ${dest}\n`);

  const stale = [];
  const missing = [];
  const clean = [];

  for (const name of SKILL_NAMES) {
    const srcFingerprint = fingerprint(path.join(srcRoot, name));
    const destFingerprint = fingerprint(path.join(dest, name));

    if (destFingerprint === null) {
      missing.push(name);
    } else if (srcFingerprint !== destFingerprint) {
      stale.push(name);
    } else {
      clean.push(name);
    }
  }

  for (const name of clean) {
    console.log(`  up to date  ${name}`);
  }
  for (const name of stale) {
    console.log(`  STALE       ${name} (installed copy differs from skills/wiki/)`);
  }
  for (const name of missing) {
    console.log(`  MISSING     ${name} (not installed at ${path.join(dest, name)})`);
  }

  if (stale.length === 0 && missing.length === 0) {
    console.log(`\n${clean.length} skills up to date. Nothing to do.`);
    return;
  }

  console.log(
    `\n${stale.length + missing.length} of ${SKILL_NAMES.length} skills are stale or missing.`,
  );
  console.log('Run:');
  console.log('  npm run skills:install');
  console.log('then start a new Cursor agent chat so the refreshed skills are re-discovered.');
  process.exit(1);
}

main();
