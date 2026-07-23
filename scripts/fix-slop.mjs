#!/usr/bin/env node
/**
 * Auto-fix deterministic llm-slop character findings + strip decorative emoji.
 * Phrase findings are reported but not rewritten.
 * Wiki vault: `npm run slop:fix:wiki` / `node scripts/fix-slop.mjs --wiki`
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EMOJI_RE,
  findEmojiHits,
  parseSlopArgs,
  REPO_EXCLUDES,
  resolveFindingPath,
  resolveVaultPath,
  root,
  runSlopScan,
  walkTextFiles,
  WIKI_EXCLUDES,
} from './slop-lib.mjs';

const { wiki } = parseSlopArgs();

let target = root;
let excludes = REPO_EXCLUDES;
let label = 'slop:fix';

if (wiki) {
  const vault = resolveVaultPath();
  if (!vault) {
    console.error('slop:fix:wiki failed: could not resolve OBSIDIAN_VAULT_PATH.');
    console.error(
      'Set OBSIDIAN_VAULT_PATH, or configure it in ~/.cursor/mcp.json under cursidian.env.',
    );
    process.exit(1);
  }
  target = vault;
  excludes = WIKI_EXCLUDES;
  label = 'slop:fix:wiki';
  console.log(`${label} - vault: ${vault}`);
}

const scan = runSlopScan({ format: 'json', target, excludes });

if (scan.error) {
  console.error(`${label} failed: ${scan.error}`);
  if (scan.stderr) console.error(scan.stderr);
  process.exit(1);
}

const findings = scan.findings || [];
const charFindings = findings.filter((f) => f.code === 'char');
const phraseFindings = findings.filter((f) => f.code !== 'char');

function parseFix(message) {
  if (/fix:\s*delete/i.test(message)) return '';
  const m = message.match(/fix:\s*"((?:\\.|[^"])*)"/i);
  if (!m) return undefined;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function offsetAt(text, line, col) {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line && offset < text.length) {
    const next = text.indexOf('\n', offset);
    if (next === -1) break;
    offset = next + 1;
    currentLine++;
  }
  return offset + (col - 1);
}

const byFile = new Map();
for (const f of charFindings) {
  const abs = resolveFindingPath(f.path, target);
  if (!byFile.has(abs)) byFile.set(abs, []);
  byFile.get(abs).push(f);
}

let filesChanged = 0;
let replacements = 0;

for (const [file, items] of byFile) {
  let text = fs.readFileSync(file, 'utf8');
  const sorted = [...items].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.col - a.col;
  });

  let changed = false;
  for (const f of sorted) {
    const fix = parseFix(f.message);
    if (fix === undefined) {
      console.warn(`No fix parsed for ${f.path}:${f.line}:${f.col} - ${f.message}`);
      continue;
    }
    const start = offsetAt(text, f.line, f.col);
    const end = offsetAt(text, f.endLine, f.endCol);
    if (start < 0 || end <= start || end > text.length) {
      console.warn(
        `Bad range ${f.path}:${f.line}:${f.col} start=${start} end=${end} len=${text.length}`,
      );
      continue;
    }
    text = text.slice(0, start) + fix + text.slice(end);
    replacements++;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, text, 'utf8');
    filesChanged++;
    console.log(`Fixed ${items.length} in ${path.relative(wiki ? target : root, file)}`);
  }
}

console.log(`\nDone: ${replacements} character fixes across ${filesChanged} files.`);
if (phraseFindings.length) {
  console.log(`Skipped ${phraseFindings.length} non-character findings (no auto-fix):`);
  for (const f of phraseFindings) {
    console.log(`  ${f.path}:${f.line}:${f.col}  ${f.message}`);
  }
}

let emojiFiles = 0;
let emojiRemovals = 0;
for (const file of walkTextFiles(target)) {
  if (path.basename(file) === '.cursidian-slop.json' || path.basename(file) === '.llmsloprc.json')
    continue;
  const before = fs.readFileSync(file, 'utf8');
  let n = 0;
  const after = before.replace(new RegExp(EMOJI_RE.source, EMOJI_RE.flags), () => {
    n++;
    return '';
  });
  if (n > 0) {
    const cleaned = after.replace(/ {2,}/g, ' ');
    fs.writeFileSync(file, cleaned, 'utf8');
    emojiFiles++;
    emojiRemovals += n;
    console.log(`Removed ${n} emoji(s) in ${path.relative(wiki ? target : root, file)}`);
  }
}
console.log(`Emoji pass: removed ${emojiRemovals} across ${emojiFiles} files.`);

const remaining = runSlopScan({ format: 'json', target, excludes });
const remainingPhrases = (remaining.findings || []).filter((f) => f.code !== 'char');
const remainingEmoji = findEmojiHits(target);
if (remainingPhrases.length || remainingEmoji.length) {
  console.error(
    `\n${label} incomplete - ${remainingPhrases.length} phrase(s), ${remainingEmoji.length} emoji(s) still present.`,
  );
  console.error(
    `Run ${wiki ? 'npm run slop:check:wiki' : 'npm run slop:check'} for details, then rewrite phrase hits by hand.`,
  );
  process.exit(1);
}

console.log(`\n${label} - clean`);
