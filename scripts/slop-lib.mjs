import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRules,
  offsetToLineCol,
  resolveLocalConfigPath,
  scanText,
} from '../src/lib/slop-engine/index.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Packs match defaults - skip cliches/academic (noisy in TS). */
export const SLOP_PACKS = ['claudeisms', 'structural', 'puffery', 'security'];

export const REPO_EXCLUDES = [
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '*.map',
  'package-lock.json',
  '.cursidian-slop.json',
  '.llmsloprc.json',
  'rules/slop',
  'tests/fixtures',
];

export const WIKI_EXCLUDES = [
  '.obsidian',
  '.trash',
  '.cursidian-trash',
  '.git',
  'node_modules',
];

const PROSE_EXTENSIONS = new Map([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.mdown', 'markdown'],
  ['.txt', 'plaintext'],
  ['.text', 'plaintext'],
]);

const CODE_EXTENSIONS = new Map([
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
  ['.cs', 'csharp'],
  ['.cpp', 'cpp'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
  ['.sh', 'shellscript'],
  ['.bash', 'shellscript'],
  ['.zsh', 'shellscript'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
]);

function languageFor(file, scanComments) {
  const ext = path.extname(file).toLowerCase();
  const prose = PROSE_EXTENSIONS.get(ext);
  if (prose) return prose;
  if (scanComments) {
    return CODE_EXTENSIONS.get(ext) ?? null;
  }
  return null;
}

function isExcluded(relPosix, excludes) {
  const base = path.posix.basename(relPosix);
  const parts = relPosix.split('/');
  return excludes.some((raw) => {
    const r = String(raw).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (r.includes('*')) {
      // simple suffix/prefix globs used in REPO_EXCLUDES
      if (r.startsWith('*.')) return base.endsWith(r.slice(1));
      return false;
    }
    if (r.includes('/')) return relPosix === r || relPosix.startsWith(`${r}/`);
    return base === r || parts.includes(r);
  });
}

function walkScanFiles(dir, excludes, scanComments, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.cursidian-slop.json') {
      // skip hidden dirs/files except we already exclude config by name
      if (ent.isDirectory()) continue;
    }
    const full = path.join(dir, ent.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (isExcluded(rel, excludes) || isExcluded(ent.name, excludes)) continue;
    if (ent.isDirectory()) {
      if (
        ent.name === 'node_modules' ||
        ent.name === 'dist' ||
        ent.name === '.git' ||
        ent.name === 'coverage'
      ) {
        continue;
      }
      walkScanFiles(full, excludes, scanComments, out);
    } else if (ent.isFile()) {
      if (languageFor(full, scanComments)) out.push(full);
    }
  }
  return out;
}

function vaultFromMcpJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const servers = parsed?.mcpServers ?? {};
    for (const server of Object.values(servers)) {
      const vaultPath = server?.env?.OBSIDIAN_VAULT_PATH;
      if (typeof vaultPath === 'string' && vaultPath.trim()) {
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

  const homeMcp = path.join(os.homedir(), '.cursor', 'mcp.json');
  const fromHome = vaultFromMcpJson(homeMcp);
  if (fromHome) return path.resolve(fromHome);

  const example = vaultFromMcpJson(path.join(root, 'examples', 'cursor-mcp.json'));
  if (example && fs.existsSync(example)) return path.resolve(example);

  return null;
}

export function parseSlopArgs(argv = process.argv.slice(2)) {
  const wiki = argv.includes('--wiki');
  const rest = argv.filter((a) => a !== '--wiki');
  return { wiki, rest };
}

/**
 * @param {{ format?: 'pretty'|'json', target?: string, excludes?: string[], scanComments?: boolean }} opts
 */
export function runSlopScan({
  format = 'pretty',
  target = root,
  excludes = REPO_EXCLUDES,
  scanComments = true,
} = {}) {
  const absTarget = path.resolve(target);
  const configPath = resolveLocalConfigPath(root);
  if (!configPath) {
    return {
      ok: false,
      findings: [],
      error: `Missing ${path.join(root, '.cursidian-slop.json')} (or legacy .llmsloprc.json)`,
      stdout: '',
      stderr: '',
      status: 1,
    };
  }

  let rules;
  try {
    rules = loadRules({
      packageRoot: root,
      enabledPacks: SLOP_PACKS,
      localRulePaths: [configPath],
      useBuiltin: true,
    });
  } catch (e) {
    return {
      ok: false,
      findings: [],
      error: e instanceof Error ? e.message : String(e),
      stdout: '',
      stderr: '',
      status: 1,
    };
  }

  const files = [];
  if (fs.existsSync(absTarget) && fs.statSync(absTarget).isFile()) {
    if (languageFor(absTarget, scanComments)) files.push(absTarget);
  } else {
    // When scanning a non-repo root (wiki), walk relative to that target.
    const walkRoot = absTarget;
    const collect = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(absTarget, full).split(path.sep).join('/');
        if (isExcluded(rel, excludes) || isExcluded(ent.name, excludes)) continue;
        if (ent.isDirectory()) {
          if (
            ent.name === 'node_modules' ||
            ent.name === 'dist' ||
            ent.name === '.git' ||
            ent.name === 'coverage' ||
            ent.name === '.obsidian' ||
            ent.name === '.trash'
          ) {
            continue;
          }
          collect(full);
        } else if (ent.isFile() && languageFor(full, scanComments)) {
          files.push(full);
        }
      }
    };
    if (absTarget === root) {
      walkScanFiles(root, excludes, scanComments, files);
    } else {
      collect(walkRoot);
    }
  }

  const findings = [];
  for (const file of files) {
    const lang = languageFor(file, scanComments);
    if (!lang) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = scanText(text, rules, lang);
    const rel =
      absTarget === root
        ? path.relative(root, file).split(path.sep).join('/') || path.basename(file)
        : path.relative(absTarget, file).split(path.sep).join('/') || path.basename(file);
    for (const f of hits) {
      const start = offsetToLineCol(text, f.offset);
      const end = offsetToLineCol(text, f.offset + f.length);
      findings.push({
        path: rel,
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

  const stdout =
    format === 'json'
      ? JSON.stringify(findings, null, 2) + '\n'
      : findings.length === 0
        ? 'No slop found.\n'
        : findings.map((f) => `${f.path}:${f.line}:${f.col}  ${f.message}`).join('\n') + '\n';

  return {
    ok: findings.length === 0,
    findings,
    error: null,
    stdout,
    stderr: '',
    status: findings.length === 0 ? 0 : 1,
    target: absTarget,
  };
}

/** Keeps (c)(r)TM. Matches Extended_Pictographic (+ optional FE0F / ZWJ sequences). */
export const EMOJI_RE =
  /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}(?:\uFE0F|\u200D(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}\uFE0F?)*/gu;

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.obsidian',
  '.trash',
  '.cursidian-trash',
]);

const TEXT_EXT = new Set([
  '.md',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.svg',
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
    const base = path.basename(file);
    if (base === '.cursidian-slop.json' || base === '.llmsloprc.json') continue;
    const text = fs.readFileSync(file, 'utf8');
    let m;
    const re = new RegExp(EMOJI_RE.source, EMOJI_RE.flags);
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split('\n').length;
      const col = before.length - before.lastIndexOf('\n');
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

/** Resolve a finding path relative to the scan target (repo root or vault) to an absolute file path. */
export function resolveFindingPath(findingPath, base = root) {
  return path.resolve(base, findingPath);
}
