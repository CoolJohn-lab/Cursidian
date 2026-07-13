import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Packs match .vscode/settings.json - skip cliches/academic (noisy in TS). */
export const SLOP_PACKS = "claudeisms,structural,puffery,security";

export const REPO_EXCLUDES = [
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "*.map",
  "package-lock.json",
  ".llmsloprc.json",
];

export const WIKI_EXCLUDES = [
  ".obsidian",
  ".trash",
  ".cursidian-trash",
  ".git",
  "node_modules",
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

function vaultFromMcpJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const servers = parsed?.mcpServers ?? {};
    for (const server of Object.values(servers)) {
      const vaultPath = server?.env?.OBSIDIAN_VAULT_PATH;
      if (typeof vaultPath === "string" && vaultPath.trim()) {
        return vaultPath.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve the Obsidian wiki vault path.
 * Order: OBSIDIAN_VAULT_PATH -> ~/.cursor/mcp.json -> examples/cursor-mcp.json (if path exists).
 */
export function resolveVaultPath() {
  if (process.env.OBSIDIAN_VAULT_PATH?.trim()) {
    return path.resolve(process.env.OBSIDIAN_VAULT_PATH.trim());
  }

  const homeMcp = path.join(os.homedir(), ".cursor", "mcp.json");
  const fromHome = vaultFromMcpJson(homeMcp);
  if (fromHome) return path.resolve(fromHome);

  const example = vaultFromMcpJson(path.join(root, "examples", "cursor-mcp.json"));
  if (example && fs.existsSync(example)) return path.resolve(example);

  return null;
}

export function parseSlopArgs(argv = process.argv.slice(2)) {
  const wiki = argv.includes("--wiki");
  const rest = argv.filter((a) => a !== "--wiki");
  return { wiki, rest };
}

/**
 * @param {{ format?: 'pretty'|'json', target?: string, excludes?: string[], scanComments?: boolean }} opts
 */
export function runSlopScan({
  format = "pretty",
  target = root,
  excludes = REPO_EXCLUDES,
  scanComments = true,
} = {}) {
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

  const configPath = path.join(root, ".llmsloprc.json");
  const absTarget = path.resolve(target);

  const args = [
    cliJs,
    `--format=${format}`,
    `--config=${configPath}`,
    `--pack=${SLOP_PACKS}`,
    ...excludes.flatMap((p) => [`--exclude=${p}`]),
  ];
  if (scanComments) args.push("--scan-comments");
  args.push(absTarget);

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
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
    ok: status === 0 && (format !== "json" || findings.length === 0),
    findings,
    error: null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status,
    target: absTarget,
  };
}

/** Keeps (c)(r)TM. Matches Extended_Pictographic (+ optional FE0F / ZWJ sequences). */
export const EMOJI_RE =
  /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}(?:\uFE0F|\u200D(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}\uFE0F?)*/gu;

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  ".obsidian",
  ".trash",
  ".cursidian-trash",
]);

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

export function walkTextFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTextFiles(p, out);
    else if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

export function findEmojiHits(baseDir = root) {
  const hits = [];
  const absBase = path.resolve(baseDir);
  for (const file of walkTextFiles(absBase)) {
    if (path.basename(file) === ".llmsloprc.json") continue;
    const text = fs.readFileSync(file, "utf8");
    let m;
    const re = new RegExp(EMOJI_RE.source, EMOJI_RE.flags);
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const col = before.length - before.lastIndexOf("\n");
      hits.push({
        path: path.relative(absBase, file),
        absPath: file,
        line,
        col,
        match: m[0],
      });
    }
  }
  return hits;
}

/** Resolve a finding path relative to scan cwd (repo root) to an absolute file path. */
export function resolveFindingPath(findingPath) {
  return path.resolve(root, findingPath);
}
