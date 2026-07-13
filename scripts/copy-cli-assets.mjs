#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'scripts', 'install-skills.mjs');
const destDir = path.join(repoRoot, 'dist', 'cli');
const dest = path.join(destDir, 'install-skills.js');

if (!fs.existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
let body = fs.readFileSync(src, 'utf8');
body = body.replace(
  "const repoRoot = path.resolve(__dirname, '..');",
  "const repoRoot = path.resolve(__dirname, '..', '..');",
);
body = body.replace(
  "const srcRoot = path.join(repoRoot, 'skills', 'wiki');",
  "const srcRoot = path.join(repoRoot, 'skills', 'wiki');",
);
fs.writeFileSync(dest, body, 'utf8');
console.error(`copied CLI: ${dest}`);

const slopRcSrc = path.join(repoRoot, '.llmsloprc.json');
const slopRcDest = path.join(repoRoot, 'dist', '.llmsloprc.json');
if (fs.existsSync(slopRcSrc)) {
  fs.copyFileSync(slopRcSrc, slopRcDest);
  console.error(`copied slop config: ${slopRcDest}`);
}
