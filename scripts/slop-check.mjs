#!/usr/bin/env node
/**
 * Fail if LLM-slop character/phrase findings or any decorative emoji remain.
 * Used as `prebuild` so `npm run build` cannot succeed with slop present.
 */
import path from "node:path";
import { findEmojiHits, root, runSlopScan } from "./slop-lib.mjs";

const scan = runSlopScan({ format: "json" });

if (scan.error) {
  console.error(`slop:check failed: ${scan.error}`);
  if (scan.stderr) console.error(scan.stderr);
  process.exit(1);
}

const emojiHits = findEmojiHits();
const findings = scan.findings || [];

if (findings.length === 0 && emojiHits.length === 0) {
  console.log("slop:check — clean");
  process.exit(0);
}

if (findings.length) {
  console.error(`\nslop:check — ${findings.length} llm-slop finding(s):\n`);
  for (const f of findings) {
    const rel = path.relative(root, path.resolve(root, f.path)).replace(/\\/g, "/");
    console.error(`  ${rel}:${f.line}:${f.col}  ${f.message}`);
  }
}

if (emojiHits.length) {
  console.error(`\nslop:check — ${emojiHits.length} emoji(s) (banned):\n`);
  for (const h of emojiHits.slice(0, 50)) {
    console.error(`  ${h.path.replace(/\\/g, "/")}:${h.line}:${h.col}  ${JSON.stringify(h.match)}`);
  }
  if (emojiHits.length > 50) {
    console.error(`  ... and ${emojiHits.length - 50} more`);
  }
}

console.error(`\nFix with: npm run slop:fix`);
console.error(`Then rewrite any remaining phrase findings by hand.\n`);
process.exit(1);
