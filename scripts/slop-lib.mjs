import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Packs match .vscode/settings.json - skip cliches/academic (noisy in TS). */
export const SLOP_PACKS = "claudeisms,structural,puffery,security";

export const SLOP_EXCLUDES = [
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "*.map",
  "package-lock.json",
  ".llmsloprc.json",
];

export function resolveCliJs() {
  const candidates = [];

  try {
    candidates.push(require.resolve("llm-slop-detector/out/cli.js"));
  } catch {
    // not installed locally
  }

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
      path.join(
        process.env.HOME,
        ".npm-global",
        "lib",
        "node_modules",
        "llm-slop-detector",
        "out",
        "cli.js",
      ),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function runSlopScan({ format = "pretty" } = {}) {
  const cliJs = resolveCliJs();
  if (!cliJs) {
    return {
      ok: false,
      findings: [],
      error:
        "llm-slop-detector not found. Install with: npm install (devDependency) or npm i -g llm-slop-detector",
      stdout: "",
      stderr: "",
      status: 1,
    };
  }

  const args = [
    cliJs,
    `--format=${format}`,
    "--scan-comments",
    `--pack=${SLOP_PACKS}`,
    ...SLOP_EXCLUDES.flatMap((p) => [`--exclude=${p}`]),
    ".",
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    return {
      ok: false,
      findings: [],
      error: result.error.message,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: 1,
    };
  }

  let findings = [];
  if (format === "json") {
    try {
      findings = JSON.parse(result.stdout || "[]");
    } catch (e) {
      return {
        ok: false,
        findings: [],
        error: `Failed to parse llm-slop JSON: ${e.message}`,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        status: 1,
      };
    }
  }

  const status = result.status ?? 1;
  return {
    ok: status === 0 && findings.length === 0,
    findings,
    error: null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status,
  };
}

/** Keeps © ® ™. Matches Extended_Pictographic (+ optional FE0F / ZWJ sequences). */
export const EMOJI_RE =
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

export function walkTextFiles(dir = root, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTextFiles(p, out);
    else if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

export function findEmojiHits() {
  const hits = [];
  for (const file of walkTextFiles()) {
    if (path.basename(file) === ".llmsloprc.json") continue;
    const text = fs.readFileSync(file, "utf8");
    let m;
    const re = new RegExp(EMOJI_RE.source, EMOJI_RE.flags);
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const col = before.length - before.lastIndexOf("\n");
      hits.push({
        path: path.relative(root, file),
        line,
        col,
        match: m[0],
      });
    }
  }
  return hits;
}

export { root };
