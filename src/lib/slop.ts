import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { readFileBounded } from './security.js';
import {
  loadRules as loadEngineRules,
  resolveLocalConfigPath,
  scanText,
  type LoadedRules,
  type ScanFinding,
} from './slop-engine/index.js';
import { toRelativePath } from './vault.js';
import { listVaultMarkdownPaths, vaultGlob } from './vault-glob.js';
import { TRASH_GLOB_IGNORE } from './trash.js';

/** Packs match defaults - skip cliches/academic (noisy in TS). */
export const SLOP_PACKS = ['claudeisms', 'structural', 'puffery', 'security'] as const;

/** Keeps (c)(r)TM. Matches Extended_Pictographic (+ optional FE0F / ZWJ sequences). */
export const EMOJI_RE =
  /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}(?:\uFE0F|\u200D(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}\uFE0F?)*/gu;

const WIKI_GLOB_IGNORES = [
  TRASH_GLOB_IGNORE,
  '**/.obsidian/**',
  '**/.trash/**',
  '**/.git/**',
  '**/node_modules/**',
];

export type { LoadedRules, ScanFinding };

export type SlopRegion = 'body' | 'frontmatter' | 'emoji';

export interface SlopFinding {
  path: string;
  region: SlopRegion;
  code: 'char' | 'phrase' | 'emoji';
  message: string;
  matchText: string;
  offset?: number;
}

export interface FileSlopPlan {
  relativePath: string;
  absolutePath: string;
  original: string;
  cleaned: string;
  changed: boolean;
  summaryChanged: boolean;
  bodyCharFixes: number;
  frontmatterCharFixes: number;
  emojiRemovals: number;
  phraseFindings: SlopFinding[];
  findings: SlopFinding[];
}

export interface VaultSlopReport {
  fileCount: number;
  findings: SlopFinding[];
  phraseFindings: SlopFinding[];
  filesToChange: FileSlopPlan[];
  wouldChange: boolean;
  summariesWouldChange: boolean;
  incomplete: boolean;
  skipped: Array<{ path: string; reason: string }>;
}

let cachedRules: LoadedRules | null = null;
let cachedRulesKey: string | null = null;

export function resolvePackageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..'), // dist/lib or src/lib -> package root
    path.resolve(here, '..'),
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'package.json')) &&
      (resolveLocalConfigPath(candidate) ||
        fs.existsSync(path.join(candidate, 'rules', 'slop', 'builtin-typography.json')))
    ) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  return path.resolve(here, '..', '..');
}

export function loadSlopRules(): LoadedRules {
  const packageRoot = resolvePackageRoot();
  const configPath = resolveLocalConfigPath(packageRoot);
  const key = `${packageRoot}|${configPath ?? ''}|${SLOP_PACKS.join(',')}`;
  if (cachedRules && cachedRulesKey === key) {
    return cachedRules;
  }

  cachedRules = loadEngineRules({
    packageRoot,
    enabledPacks: [...SLOP_PACKS],
    localRulePaths: configPath ? [configPath] : [],
    useBuiltin: true,
  });
  cachedRulesKey = key;
  return cachedRules;
}

/** Test helper to clear cached rules between suites. */
export function clearSlopRulesCache(): void {
  cachedRules = null;
  cachedRulesKey = null;
}

function parseFixMessage(message: string): string | undefined {
  if (/fix:\s*delete/i.test(message)) return '';
  const m = message.match(/fix:\s*"((?:\\.|[^"])*)"/i);
  if (!m) return undefined;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function applyBodyCharFixes(
  text: string,
  findings: ScanFinding[],
  relativePath: string,
): { text: string; count: number; findings: SlopFinding[] } {
  const charFindings = findings.filter((f) => f.code === 'char');
  const report: SlopFinding[] = [];
  let next = text;
  let count = 0;

  const sorted = [...charFindings].sort((a, b) => b.offset - a.offset);
  for (const f of sorted) {
    const fix = parseFixMessage(f.message);
    if (fix === undefined) continue;
    const end = f.offset + f.length;
    if (f.offset < 0 || end > next.length || end < f.offset) continue;
    next = next.slice(0, f.offset) + fix + next.slice(end);
    count++;
    report.push({
      path: relativePath,
      region: 'body',
      code: 'char',
      message: f.message,
      matchText: f.matchText,
      offset: f.offset,
    });
  }

  return { text: next, count, findings: report };
}

function stripEmoji(text: string): { text: string; count: number } {
  let count = 0;
  const stripped = text.replace(new RegExp(EMOJI_RE.source, EMOJI_RE.flags), () => {
    count++;
    return '';
  });
  if (count === 0) return { text, count: 0 };
  return { text: stripped.replace(/ {2,}/g, ' '), count };
}

function deslopStringValue(
  value: string,
  rules: LoadedRules,
  relativePath: string,
  fieldPath: string,
): { value: string; charFixes: number; emojiRemovals: number; findings: SlopFinding[] } {
  const findings = scanText(value, rules, 'plaintext');
  const applied = applyBodyCharFixes(value, findings, relativePath);
  const remappedFindings = applied.findings.map((f) => ({
    ...f,
    region: 'frontmatter' as const,
    message: `${fieldPath}: ${f.message}`,
  }));

  const emoji = stripEmoji(applied.text);
  if (emoji.count > 0) {
    remappedFindings.push({
      path: relativePath,
      region: 'frontmatter',
      code: 'emoji',
      message: `${fieldPath}: decorative emoji`,
      matchText: '',
    });
  }

  return {
    value: emoji.text,
    charFixes: applied.count,
    emojiRemovals: emoji.count,
    findings: remappedFindings,
  };
}

function deslopFrontmatterValue(
  value: unknown,
  rules: LoadedRules,
  relativePath: string,
  fieldPath: string,
): {
  value: unknown;
  charFixes: number;
  emojiRemovals: number;
  findings: SlopFinding[];
  summaryChanged: boolean;
} {
  if (typeof value === 'string') {
    const result = deslopStringValue(value, rules, relativePath, fieldPath);
    const summaryChanged = fieldPath === 'summary' && result.value !== value;
    return {
      value: result.value,
      charFixes: result.charFixes,
      emojiRemovals: result.emojiRemovals,
      findings: result.findings,
      summaryChanged,
    };
  }

  if (Array.isArray(value)) {
    let charFixes = 0;
    let emojiRemovals = 0;
    let summaryChanged = false;
    const findings: SlopFinding[] = [];
    const next = value.map((item, index) => {
      const child = deslopFrontmatterValue(item, rules, relativePath, `${fieldPath}[${index}]`);
      charFixes += child.charFixes;
      emojiRemovals += child.emojiRemovals;
      summaryChanged = summaryChanged || child.summaryChanged;
      findings.push(...child.findings);
      return child.value;
    });
    return { value: next, charFixes, emojiRemovals, findings, summaryChanged };
  }

  if (value && typeof value === 'object') {
    let charFixes = 0;
    let emojiRemovals = 0;
    let summaryChanged = false;
    const findings: SlopFinding[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      const childPath = fieldPath ? `${fieldPath}.${key}` : key;
      const child = deslopFrontmatterValue(childValue, rules, relativePath, childPath);
      next[key] = child.value;
      charFixes += child.charFixes;
      emojiRemovals += child.emojiRemovals;
      summaryChanged = summaryChanged || child.summaryChanged;
      findings.push(...child.findings);
    }
    return { value: next, charFixes, emojiRemovals, findings, summaryChanged };
  }

  return { value, charFixes: 0, emojiRemovals: 0, findings: [], summaryChanged: false };
}

/**
 * Rebuild file with a new body while keeping the original YAML fence bytes.
 * `newBody` must match parseFrontmatter(raw).content (one trailing fence newline already stripped).
 */
function replaceBodyPreservingFrontmatter(raw: string, newBody: string): string {
  if (!raw.startsWith('---')) {
    return newBody;
  }
  // Include the same \r?\n that parseFrontmatter consumes after the closing ---.
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n)?/);
  if (!match) {
    return newBody;
  }
  const sep = match[1] ?? '';
  const fence = match[0].slice(0, match[0].length - sep.length);
  if (newBody.length === 0) {
    return `${fence}${sep}`;
  }
  // No original sep (EOF right after ---): insert LF so body is not glued to the fence.
  const join = sep || '\n';
  return `${fence}${join}${newBody}`;
}

export function planFileDeslop(
  absolutePath: string,
  vaultPath: string,
  raw: string,
  rules: LoadedRules,
): FileSlopPlan {
  const relativePath = toRelativePath(vaultPath, absolutePath).replace(/\\/g, '/');

  const parsed = parseFrontmatter(raw);
  const bodyScan = scanText(parsed.content, rules, 'markdown');
  const bodyApplied = applyBodyCharFixes(parsed.content, bodyScan, relativePath);
  const bodyEmoji = stripEmoji(bodyApplied.text);

  const phraseFindings: SlopFinding[] = bodyScan
    .filter((f) => f.code === 'phrase')
    .map((f) => ({
      path: relativePath,
      region: 'body' as const,
      code: 'phrase' as const,
      message: f.message,
      matchText: f.matchText,
      offset: f.offset,
    }));

  const fm = deslopFrontmatterValue(parsed.data, rules, relativePath, '');
  if (typeof parsed.data.summary === 'string') {
    phraseFindings.push(
      ...scanText(parsed.data.summary, rules, 'plaintext')
        .filter((f) => f.code === 'phrase')
        .map((f) => ({
          path: relativePath,
          region: 'frontmatter' as const,
          code: 'phrase' as const,
          message: `summary: ${f.message}`,
          matchText: f.matchText,
          offset: f.offset,
        })),
    );
  }

  const cleanedBody = bodyEmoji.text;
  const cleanedData = fm.value as Record<string, unknown>;
  const bodyTouched = bodyApplied.count > 0 || bodyEmoji.count > 0;
  const frontmatterTouched = fm.charFixes > 0 || fm.emojiRemovals > 0;

  let cleaned: string;
  if (!frontmatterTouched && !bodyTouched) {
    // Avoid false positives from fence/body reassembly (blank line / CRLF).
    cleaned = raw;
  } else if (!frontmatterTouched) {
    cleaned = replaceBodyPreservingFrontmatter(raw, cleanedBody);
  } else if (Object.keys(cleanedData).length === 0) {
    cleaned = cleanedBody;
  } else {
    cleaned = stringifyFrontmatter(cleanedData, cleanedBody);
  }

  const findings: SlopFinding[] = [...bodyApplied.findings, ...fm.findings];
  if (bodyEmoji.count > 0) {
    findings.push({
      path: relativePath,
      region: 'emoji',
      code: 'emoji',
      message: 'decorative emoji in body',
      matchText: '',
    });
  }

  const changed = cleaned !== raw;
  return {
    relativePath,
    absolutePath,
    original: raw,
    cleaned,
    changed,
    summaryChanged: fm.summaryChanged,
    bodyCharFixes: bodyApplied.count,
    frontmatterCharFixes: fm.charFixes,
    emojiRemovals: bodyEmoji.count + fm.emojiRemovals,
    phraseFindings,
    findings,
  };
}

export async function analyzeVaultSlop(
  vaultPath: string,
  maxFileSize: number,
): Promise<VaultSlopReport> {
  const rules = loadSlopRules();
  const absolutePaths = await vaultGlob(vaultPath, '**/*.md', {
    ignore: WIKI_GLOB_IGNORES,
  });

  // Prefer vaultGlob; fall back keeps tests that only use list helper semantics.
  const paths = absolutePaths.length > 0 ? absolutePaths : await listVaultMarkdownPaths(vaultPath);

  const filesToChange: FileSlopPlan[] = [];
  const findings: SlopFinding[] = [];
  const phraseFindings: SlopFinding[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let summariesWouldChange = false;

  for (const absolutePath of paths) {
    const relativePath = toRelativePath(vaultPath, absolutePath).replace(/\\/g, '/');
    try {
      const raw = await readFileBounded(absolutePath, maxFileSize);
      const plan = planFileDeslop(absolutePath, vaultPath, raw, rules);
      findings.push(...plan.findings);
      phraseFindings.push(...plan.phraseFindings);
      if (plan.changed) {
        filesToChange.push(plan);
        if (plan.summaryChanged) summariesWouldChange = true;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ path: relativePath, reason });
    }
  }

  // Deduplicate phrase findings that may have been pushed twice.
  const uniquePhrases = new Map<string, SlopFinding>();
  for (const f of phraseFindings) {
    uniquePhrases.set(`${f.path}|${f.region}|${f.offset ?? ''}|${f.matchText}|${f.message}`, f);
  }

  return {
    fileCount: paths.length,
    findings,
    phraseFindings: [...uniquePhrases.values()],
    filesToChange,
    wouldChange: filesToChange.length > 0,
    summariesWouldChange,
    incomplete: skipped.length > 0,
    skipped,
  };
}
