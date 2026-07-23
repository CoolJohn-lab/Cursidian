#!/usr/bin/env node
/**
 * Scan explicit file paths; print JSON findings (CLI shape for deslop.mjs).
 * Usage: tsx scripts/slop-scan-files.mjs [--scan-comments] [--pack a,b] <files...>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRules,
  offsetToLineCol,
  resolveLocalConfigPath,
  scanText,
} from '../src/lib/slop-engine/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROSE = new Map([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.mdown', 'markdown'],
  ['.txt', 'plaintext'],
  ['.text', 'plaintext'],
]);
const CODE = new Map([
  ['.ts', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.tsx', 'typescriptreact'],
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsx', 'javascriptreact'],
  ['.py', 'python'],
  ['.rs', 'rust'],
  ['.go', 'go'],
  ['.java', 'java'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.sh', 'shellscript'],
  ['.bash', 'shellscript'],
  ['.zsh', 'shellscript'],
]);

const argv = process.argv.slice(2);
let scanComments = false;
let packs = ['claudeisms', 'structural', 'puffery', 'security'];
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--scan-comments') scanComments = true;
  else if (a === '--pack') {
    packs = String(argv[++i] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (a.startsWith('--pack=')) {
    packs = a
      .slice('--pack='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (!a.startsWith('-')) {
    files.push(path.resolve(a));
  }
}

function languageFor(file) {
  const ext = path.extname(file).toLowerCase();
  const prose = PROSE.get(ext);
  if (prose) return prose;
  if (scanComments) return CODE.get(ext) ?? null;
  return null;
}

const configPath = resolveLocalConfigPath(root);
if (!configPath) {
  console.error('Missing .cursidian-slop.json');
  process.exit(2);
}

const rules = loadRules({
  packageRoot: root,
  enabledPacks: packs,
  localRulePaths: [configPath],
  useBuiltin: true,
});

const findings = [];
for (const file of files) {
  const lang = languageFor(file);
  if (!lang || !fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const hits = scanText(text, rules, lang);
  for (const f of hits) {
    const start = offsetToLineCol(text, f.offset);
    const end = offsetToLineCol(text, f.offset + f.length);
    findings.push({
      path: file,
      line: start.line,
      col: start.col,
      endLine: end.line,
      endCol: end.col,
      code: f.code,
      severity: f.severity,
      message: f.message,
      source: f.source,
      rulePattern: f.rulePattern,
    });
  }
}

process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
process.exit(findings.length === 0 ? 0 : 1);
