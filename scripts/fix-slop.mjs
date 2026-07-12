import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function resolveCliJs() {
  const candidates = [];
  const npm = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (npm.stdout?.trim()) {
    candidates.push(path.join(npm.stdout.trim(), "llm-slop-detector", "out", "cli.js"));
  }
  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, "npm", "node_modules", "llm-slop-detector", "out", "cli.js"),
    );
  }
  if (process.env.HOME) {
    candidates.push(
      path.join(process.env.HOME, ".npm-global", "lib", "node_modules", "llm-slop-detector", "out", "cli.js"),
    );
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const cliJs = resolveCliJs();
if (!cliJs) {
  console.error("llm-slop-detector CLI not found. Install: npm i -g llm-slop-detector");
  process.exit(1);
}

// Packs match .vscode/settings.json. Skip cliches/academic: single words like
// "crucial"/"ensure"/"escalate" flood TypeScript codebases.
const cli = spawnSync(
  process.execPath,
  [
    cliJs,
    "--format=json",
    "--scan-comments",
    "--pack=claudeisms,structural,puffery,security",
    "--exclude=node_modules",
    "--exclude=dist",
    "--exclude=.git",
    "--exclude=*.map",
    "--exclude=package-lock.json",
    ".",
  ],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
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

// Full-repo emoji wipe (llm-slop only sees markdown + comments; user wants zero
// emojis in string literals / code too). Keeps © ® ™.
const EMOJI_RE =
  /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}(?:\uFE0F|\u200D(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}\uFE0F?)*/gu;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);
const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".svg",
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

let emojiFiles = 0;
let emojiRemovals = 0;
for (const file of walk(root)) {
  if (file.endsWith(`${path.sep}.llmsloprc.json`)) continue; // contains emoji as rule keys
  const before = fs.readFileSync(file, "utf8");
  let n = 0;
  const after = before.replace(EMOJI_RE, () => {
    n++;
    return "";
  });
  if (n > 0) {
    // Collapse accidental double spaces left by removals (keep newlines)
    const cleaned = after.replace(/ {2,}/g, " ");
    fs.writeFileSync(file, cleaned, "utf8");
    emojiFiles++;
    emojiRemovals += n;
    console.log(`Removed ${n} emoji(s) in ${path.relative(root, file)}`);
  }
}
console.log(`Emoji pass: removed ${emojiRemovals} across ${emojiFiles} files.`);

