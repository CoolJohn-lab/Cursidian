import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PACKS,
  LEGACY_RULES_FILENAME,
  LOCAL_RULES_FILENAME,
  type CharDef,
  type LoadedRules,
  type PhraseRule,
  type Severity,
  type SlopConfigFile,
} from './types.js';

export interface LoadRulesOptions {
  /** Package root that contains `.cursidian-slop.json` and `rules/slop/`. */
  packageRoot: string;
  /** Pack names under `rules/slop/packs/`. Defaults to DEFAULT_PACKS. */
  enabledPacks?: string[];
  /** Extra local rule JSON paths (merged last, override chars by codepoint). */
  localRulePaths?: string[];
  /** Include snapshotted builtin typography (default true). */
  useBuiltin?: boolean;
}

function parseSeverity(s: string | undefined, fallback: Severity): Severity {
  switch (s) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'information':
    case 'info':
      return 'information';
    case 'hint':
      return 'hint';
    default:
      return fallback;
  }
}

function defaultCharSeverity(char: string): Severity {
  const code = char.codePointAt(0)!;
  const invisible =
    code === 0x00ad ||
    code === 0x00a0 ||
    code === 0x1160 ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x202f ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x2060 ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x3164 ||
    code === 0xfeff;
  return invisible ? 'warning' : 'information';
}

function readJsonFile(p: string): SlopConfigFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as SlopConfigFile;
    }
    return null;
  } catch {
    return null;
  }
}

function ingestList(
  raw: SlopConfigFile,
  origin: string,
  target: {
    chars: Map<string, CharDef>;
    phrases: PhraseRule[];
    sources: LoadedRules['sources'];
  },
): void {
  const name = typeof raw.name === 'string' ? raw.name : origin;
  let charCount = 0;
  let phraseCount = 0;

  if (Array.isArray(raw.chars)) {
    for (const c of raw.chars) {
      if (typeof c.char !== 'string' || c.char.length === 0) continue;
      const charStr = c.char;
      target.chars.set(charStr, {
        char: charStr,
        name:
          typeof c.name === 'string'
            ? c.name
            : `Unknown char (U+${charStr.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`,
        severity: parseSeverity(c.severity, defaultCharSeverity(charStr)),
        replacement: typeof c.replacement === 'string' ? c.replacement : undefined,
        suggestion: typeof c.suggestion === 'string' ? c.suggestion : undefined,
        source: name,
      });
      charCount++;
    }
  }

  if (Array.isArray(raw.phrases)) {
    for (const p of raw.phrases) {
      if (typeof p.pattern !== 'string' || p.pattern.length === 0) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(p.pattern, 'gi');
      } catch {
        continue;
      }
      target.phrases.push({
        pattern: p.pattern,
        regex,
        reason: typeof p.reason === 'string' ? p.reason : undefined,
        severity: parseSeverity(p.severity, 'information'),
        source: name,
      });
      phraseCount++;
    }
  }

  target.sources.push({
    name,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    origin,
    charCount,
    phraseCount,
  });
}

function buildCharRegex(chars: Map<string, CharDef>): RegExp {
  if (chars.size === 0) return /(?!)/g;
  const body = Array.from(chars.keys())
    .map((c) => '\\u{' + c.codePointAt(0)!.toString(16) + '}')
    .join('');
  return new RegExp('[' + body + ']', 'gu');
}

export function resolveRulesDir(packageRoot: string): string {
  const primary = path.join(packageRoot, 'rules', 'slop');
  if (fs.existsSync(primary)) return primary;
  const nested = path.join(packageRoot, 'dist', 'rules', 'slop');
  if (fs.existsSync(nested)) return nested;
  return primary;
}

export function resolveLocalConfigPath(packageRoot: string): string | null {
  const candidates = [
    path.join(packageRoot, LOCAL_RULES_FILENAME),
    path.join(packageRoot, 'dist', LOCAL_RULES_FILENAME),
    path.join(packageRoot, LEGACY_RULES_FILENAME),
    path.join(packageRoot, 'dist', LEGACY_RULES_FILENAME),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadRules(opts: LoadRulesOptions): LoadedRules {
  const rulesDir = resolveRulesDir(opts.packageRoot);
  const target: {
    chars: Map<string, CharDef>;
    phrases: PhraseRule[];
    sources: LoadedRules['sources'];
  } = {
    chars: new Map(),
    phrases: [],
    sources: [],
  };

  if (opts.useBuiltin !== false) {
    const builtinPath = path.join(rulesDir, 'builtin-typography.json');
    const raw = readJsonFile(builtinPath);
    if (raw) ingestList(raw, 'built-in', target);
  }

  const packs =
    opts.enabledPacks && opts.enabledPacks.length > 0 ? opts.enabledPacks : [...DEFAULT_PACKS];

  for (const pack of packs) {
    const packPath = path.join(rulesDir, 'packs', `${pack}.json`);
    const raw = readJsonFile(packPath);
    if (raw) ingestList(raw, `pack:${pack}`, target);
  }

  const localPaths =
    opts.localRulePaths && opts.localRulePaths.length > 0
      ? opts.localRulePaths
      : (() => {
          const found = resolveLocalConfigPath(opts.packageRoot);
          return found ? [found] : [];
        })();

  for (const p of localPaths) {
    const raw = readJsonFile(p);
    if (raw) ingestList(raw, p, target);
  }

  return {
    chars: target.chars,
    phrases: target.phrases,
    charRegex: buildCharRegex(target.chars),
    sources: target.sources,
  };
}
