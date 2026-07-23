/** Comment-range scanners for code-language scope (scan comments only). */

type Range = [number, number];

const C_STYLE_LANGS = new Set([
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'rust',
  'go',
  'java',
  'csharp',
  'cpp',
  'c',
  'php',
  'swift',
  'kotlin',
  'scala',
  'dart',
]);

const PYTHON_LANGS = new Set(['python']);
const HASH_LANGS = new Set(['ruby', 'shellscript', 'perl', 'r', 'yaml']);

export function getCommentScanner(language: string): ((text: string) => Range[]) | null {
  if (C_STYLE_LANGS.has(language)) return scanCStyleComments;
  if (PYTHON_LANGS.has(language)) return scanPythonComments;
  if (HASH_LANGS.has(language)) return scanHashComments;
  return null;
}

function scanCStyleComments(text: string): Range[] {
  const ranges: Range[] = [];
  const n = text.length;
  let i = 0;
  let inString: string | null = null;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (inString !== null) {
      if (c === 92 && i + 1 < n) {
        i += 2;
        continue;
      }
      if (text[i] === inString) inString = null;
      i++;
      continue;
    }
    if (c === 47 && i + 1 < n) {
      const next = text.charCodeAt(i + 1);
      if (next === 47) {
        const start = i;
        const nl = text.indexOf('\n', i + 2);
        const end = nl === -1 ? n : nl;
        ranges.push([start, end]);
        i = end;
        continue;
      }
      if (next === 42) {
        const start = i;
        const close = text.indexOf('*/', i + 2);
        const end = close === -1 ? n : close + 2;
        ranges.push([start, end]);
        i = end;
        continue;
      }
    }
    if (c === 34 || c === 39 || c === 96) {
      inString = text[i]!;
      i++;
      continue;
    }
    i++;
  }
  return ranges;
}

function scanPythonComments(text: string): Range[] {
  const ranges: Range[] = [];
  const n = text.length;
  let i = 0;
  let inString: { quote: string; triple: boolean } | null = null;
  while (i < n) {
    if (inString !== null) {
      if (inString.triple) {
        if (text.startsWith(inString.quote.repeat(3), i)) {
          i += 3;
          inString = null;
          continue;
        }
        i++;
        continue;
      }
      if (text.charCodeAt(i) === 92 && i + 1 < n) {
        i += 2;
        continue;
      }
      if (text[i] === inString.quote) {
        inString = null;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (text.charCodeAt(i) === 35) {
      const start = i;
      const nl = text.indexOf('\n', i + 1);
      const end = nl === -1 ? n : nl;
      ranges.push([start, end]);
      i = end;
      continue;
    }
    const q = text[i];
    if (q === '"' || q === "'") {
      const triple = text.startsWith(q.repeat(3), i);
      if (triple) {
        const start = i;
        i += 3;
        const close = text.indexOf(q.repeat(3), i);
        const end = close === -1 ? n : close + 3;
        ranges.push([start, end]);
        i = end;
        continue;
      }
      inString = { quote: q, triple: false };
      i++;
      continue;
    }
    i++;
  }
  return ranges;
}

function scanHashComments(text: string): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  while (i <= text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(i, lineEnd);
    const hash = line.indexOf('#');
    if (hash !== -1) {
      ranges.push([i + hash, lineEnd]);
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  return ranges;
}
