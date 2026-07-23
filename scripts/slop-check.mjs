#!/usr/bin/env node
/**
 * Fail if LLM-slop character/phrase findings or decorative emoji remain.
 * Default: repo (also used as `prebuild`).
 * Wiki vault: `npm run slop:check:wiki` / `node scripts/slop-check.mjs --wiki`
 */
import path from "node:path";
import {
  findEmojiHits,
  parseSlopArgs,
  REPO_EXCLUDES,
  resolveFindingPath,
  resolveVaultPath,
  root,
  runSlopScan,
  WIKI_EXCLUDES,
} from "./slop-lib.mjs";

const { wiki } = parseSlopArgs();

let target = root;
let excludes = REPO_EXCLUDES;
let label = "slop:check";
let fixHint = "npm run slop:fix";

if (wiki) {
  const vault = resolveVaultPath();
  if (!vault) {
    console.error("slop:check:wiki failed: could not resolve OBSIDIAN_VAULT_PATH.");
    console.error("Set OBSIDIAN_VAULT_PATH, or configure it in ~/.cursor/mcp.json under cursidian.env.");
    process.exit(1);
  }
  target = vault;
  excludes = WIKI_EXCLUDES;
  label = "slop:check:wiki";
  fixHint = "npm run slop:fix:wiki";
  console.log(`${label} - vault: ${vault}`);
}

const scan = runSlopScan({ format: "json", target, excludes });

if (scan.error) {
  console.error(`${label} failed: ${scan.error}`);
  if (scan.stderr) console.error(scan.stderr);
  process.exit(1);
}

const emojiHits = findEmojiHits(target);
const findings = scan.findings || [];

if (findings.length === 0 && emojiHits.length === 0) {
  console.log(`${label} - clean`);
  process.exit(0);
}

if (findings.length) {
  console.error(`\n${label} - ${findings.length} llm-slop finding(s):\n`);
  for (const f of findings) {
    const abs = resolveFindingPath(f.path, target);
    const rel = path.relative(target, abs).replace(/\\/g, "/");
    console.error(`  ${rel}:${f.line}:${f.col}  ${f.message}`);
  }
}

if (emojiHits.length) {
  console.error(`\n${label} - ${emojiHits.length} emoji(s) (banned):\n`);
  for (const h of emojiHits.slice(0, 50)) {
    console.error(`  ${h.path.replace(/\\/g, "/")}:${h.line}:${h.col}  ${JSON.stringify(h.match)}`);
  }
  if (emojiHits.length > 50) {
    console.error(`  ... and ${emojiHits.length - 50} more`);
  }
}

console.error(`\nFix with: ${fixHint}`);
console.error(`Then rewrite any remaining phrase findings by hand.\n`);
process.exit(1);
