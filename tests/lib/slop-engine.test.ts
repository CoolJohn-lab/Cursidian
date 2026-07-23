import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, scanText, charDiagnosticMessage } from '../../src/lib/slop-engine/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('slop-engine', () => {
  const rules = loadRules({
    packageRoot: root,
    enabledPacks: ['claudeisms', 'structural', 'puffery', 'security'],
    useBuiltin: true,
  });

  it('replaces em dash, curly quotes, ellipsis; deletes ZWSP', () => {
    const text = 'A — B “q” …\u200B end';
    const findings = scanText(text, rules, 'plaintext');
    const byChar = Object.fromEntries(
      findings.filter((f) => f.code === 'char').map((f) => [f.matchText, f.message]),
    );
    expect(byChar['—']).toMatch(/fix: "-"/);
    expect(byChar['“']).toMatch(/fix: "\\"/);
    expect(byChar['”']).toMatch(/fix: "\\"/);
    expect(byChar['…']).toMatch(/fix: "\.\.\."/);
    expect(byChar['\u200B']).toMatch(/fix: delete/i);
  });

  it('reports deep dive phrase without auto-fix token', () => {
    const findings = scanText('Please do a deep dive on auth.', rules, 'plaintext');
    const phrase = findings.find((f) => f.code === 'phrase' && /deep dive/i.test(f.matchText));
    expect(phrase).toBeTruthy();
    expect(phrase!.message).not.toMatch(/fix:/i);
  });

  it('matches committed parity corpus against expected char/phrase codes', () => {
    const corpus = fs.readFileSync(
      path.join(root, 'tests/fixtures/slop-parity-corpus.txt'),
      'utf8',
    );
    const expected = JSON.parse(
      fs.readFileSync(path.join(root, 'tests/fixtures/slop-parity-expected.json'), 'utf8'),
    ) as Array<{
      offset: number;
      length: number;
      matchText: string;
      code: string;
      message: string;
    }>;

    const actual = scanText(corpus, rules, 'plaintext').map((f) => ({
      offset: f.offset,
      length: f.length,
      matchText: f.matchText,
      code: f.code,
      message: f.message,
    }));

    expect(actual).toEqual(expected);
  });

  it('charDiagnosticMessage stays parseable', () => {
    const def = rules.chars.get('—');
    expect(def).toBeTruthy();
    expect(charDiagnosticMessage(def!)).toMatch(/fix: "-"/);
  });
});
