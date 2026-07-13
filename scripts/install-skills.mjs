#!/usr/bin/env node
/**
 * Install Cursidian wiki skills into ~/.cursor/skills (copy only - never symlink).
 *
 * Removes each target skill folder first so Copy-into-existing cannot nest
 * as skill-name/skill-name/SKILL.md (a common PowerShell Copy-Item pitfall).
 *
 * Usage:
 *   node scripts/install-skills.mjs
 *   node scripts/install-skills.mjs --dry-run
 *   node scripts/install-skills.mjs --dest "C:\\custom\\skills"
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SKILL_NAMES = [
  'llm-wiki',
  'wiki-query',
  'wiki-lint',
  'wiki-setup',
  'wiki-ingest',
  'wiki-capture',
  'wiki-update',
  'wiki-status',
  'wiki-slop',
];

/** Legacy MCP tool names that must not appear in installed skills. */
const LEGACY_TOOL_RE =
  /\b(read_note|search_content|get_note_neighborhood|get_backlinks|touch_wiki_meta|create_note|update_note|list_notes|list_recent|list_tags|search_by_tags|manage_frontmatter|manage_folders|delete_note|rename_note|vault_health)\b/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'skills', 'wiki');

function parseArgs(argv) {
  let dryRun = false;
  let dest = path.join(os.homedir(), '.cursor', 'skills');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--dest') {
      dest = argv[++i];
      if (!dest) {
        console.error('Error: --dest requires a path');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/install-skills.mjs [--dry-run] [--dest <path>]`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return { dryRun, dest };
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function collectSkillMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSkillMarkdown(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function verifyInstalled(destRoot) {
  const problems = [];
  for (const name of SKILL_NAMES) {
    const skillDir = path.join(destRoot, name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    const nestedTrap = path.join(skillDir, name, 'SKILL.md');

    if (!fs.existsSync(skillMd)) {
      problems.push(`${name}: missing SKILL.md at ${skillMd}`);
      continue;
    }
    if (fs.existsSync(nestedTrap)) {
      problems.push(`${name}: nested duplicate ${path.join(name, name, 'SKILL.md')} - remove and reinstall`);
    }

    for (const file of collectSkillMarkdown(skillDir)) {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(LEGACY_TOOL_RE);
      if (match) {
        problems.push(`${path.relative(destRoot, file)}: legacy tool name "${match[1]}"`);
      }
    }
  }
  return problems;
}

function main() {
  const { dryRun, dest } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(srcRoot)) {
    console.error(`Source skills not found: ${srcRoot}`);
    process.exit(1);
  }

  console.log(`Source: ${srcRoot}`);
  console.log(`Dest:   ${dest}`);
  if (dryRun) console.log('(dry-run - no changes)');

  if (!dryRun) fs.mkdirSync(dest, { recursive: true });

  for (const name of SKILL_NAMES) {
    const from = path.join(srcRoot, name);
    const to = path.join(dest, name);
    if (!fs.existsSync(from)) {
      console.error(`Missing skill folder: ${from}`);
      process.exit(1);
    }
    console.log(`${dryRun ? 'Would refresh' : 'Refreshing'}: ${name}`);
    if (!dryRun) {
      rmrf(to);
      copyDir(from, to);
    }
  }

  if (dryRun) {
    const srcProblems = verifyInstalled(srcRoot);
    if (srcProblems.length) {
      console.error('\nSource skills failed verification:');
      for (const p of srcProblems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log('\nSource skills look good. Re-run without --dry-run to install.');
    return;
  }

  const problems = verifyInstalled(dest);
  if (problems.length) {
    console.error('\nInstall completed but verification failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`\nInstalled ${SKILL_NAMES.length} wiki skills. Verification passed (no nested duplicates, no legacy tool names).`);
  console.log('Reload Cursor (or start a new agent chat) so skills are re-discovered.');
}

main();
