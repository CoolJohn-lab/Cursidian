export type Severity = 'error' | 'warning' | 'information' | 'hint';

export interface CharDef {
  char: string;
  name: string;
  severity: Severity;
  replacement?: string;
  suggestion?: string;
  source: string;
}

export interface PhraseRule {
  pattern: string;
  regex: RegExp;
  reason?: string;
  severity: Severity;
  source: string;
}

export interface RuleSource {
  name: string;
  version?: string;
  description?: string;
  origin: string;
  charCount: number;
  phraseCount: number;
}

export interface LoadedRules {
  chars: Map<string, CharDef>;
  phrases: PhraseRule[];
  charRegex: RegExp;
  sources: RuleSource[];
}

export interface ScanFinding {
  offset: number;
  length: number;
  matchText: string;
  code: 'char' | 'phrase';
  severity: Severity;
  message: string;
  source: string;
  rulePattern?: string;
}

export interface SlopConfigFile {
  name?: string;
  version?: string;
  description?: string;
  packs?: string[];
  chars?: Array<{
    char: string;
    name?: string;
    severity?: string;
    replacement?: string;
    suggestion?: string;
  }>;
  phrases?: Array<{
    pattern: string;
    reason?: string;
    severity?: string;
  }>;
}

export const LOCAL_RULES_FILENAME = '.cursidian-slop.json';
export const LEGACY_RULES_FILENAME = '.llmsloprc.json';

export const DEFAULT_PACKS = [
  'claudeisms',
  'structural',
  'puffery',
  'security',
] as const;
