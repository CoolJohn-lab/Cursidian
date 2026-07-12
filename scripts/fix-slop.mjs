import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cli = spawnSync(
  "llm-slop",
  [
    "--format=json",
    "--scan-comments",
    "--exclude",
    "node_modules",
    "--exclude",
    "dist",
    "--exclude",
    ".git",
    "--exclude",
    "*.map",
    "--exclude",
    "package-lock.json",
    ".",
  ],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, shell: true },
);

if (cli.error) {
  console.error(cli.error);
  process.exit(1);
}

const findings = JSON.parse(cli.stdout || "[]");
const charFindings = findings.filter((f) => f.code === "char");
const phraseFindings = findings.filter((f) => f.code !== "char");

function parseFix(message) {
  if (/fix:\s*delete/i.test(message)) return "";
  const m = message.match(/fix:\s*"((?:\\.|[^"])*)"/i);
  if (!m) return undefined;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function offsetAt(text, line, col) {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line && offset < text.length) {
    const next = text.indexOf("\n", offset);
    if (next === -1) break;
    offset = next + 1;
    currentLine++;
  }
  return offset + (col - 1);
}

const byFile = new Map();
for (const f of charFindings) {
  const abs = path.resolve(root, f.path);
  if (!byFile.has(abs)) byFile.set(abs, []);
  byFile.get(abs).push(f);
}

let filesChanged = 0;
let replacements = 0;

for (const [file, items] of byFile) {
  let text = fs.readFileSync(file, "utf8");
  const sorted = [...items].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.col - a.col;
  });

  let changed = false;
  for (const f of sorted) {
    const fix = parseFix(f.message);
    if (fix === undefined) {
      console.warn(`No fix parsed for ${f.path}:${f.line}:${f.col} — ${f.message}`);
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
    fs.writeFileSync(file, text, "utf8");
    filesChanged++;
    console.log(`Fixed ${items.length} in ${path.relative(root, file)}`);
  }
}

console.log(`\nDone: ${replacements} character fixes across ${filesChanged} files.`);
if (phraseFindings.length) {
  console.log(`Skipped ${phraseFindings.length} non-character findings (no auto-fix).`);
}
