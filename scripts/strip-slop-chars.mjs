import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skip = new Set(["node_modules", "dist", ".git", "coverage"]);
const map = new Map([
  ["\u2014", "-"],
  ["\u2013", "-"],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u2026", "..."],
  ["\u2192", "->"],
  ["\u2190", "<-"],
  ["\u2194", "<->"],
  ["\u21D2", "=>"],
  ["\u21D0", "<="],
  ["\u27F6", "->"],
  ["\u27F5", "<-"],
  ["\u27F9", "=>"],
  ["\u27F8", "<="],
  ["\u2022", "-"],
  ["\u2023", "-"],
  ["\u25AA", "-"],
  ["\u25B8", "-"],
  ["\u25BA", "-"],
  ["\u2212", "-"],
  ["\u2011", "-"],
  ["\u2015", "-"],
  ["\u2012", "-"],
  ["\uFEFF", ""],
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let files = 0;
let replacements = 0;

for (const file of walk(root)) {
  const base = path.basename(file);
  if (base === ".cursidian-slop.json" || base === ".llmsloprc.json" || base === "package-lock.json" || file.endsWith(".map")) {
    continue;
  }

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;

  let n = 0;
  let out = "";
  for (const ch of text) {
    if (map.has(ch)) {
      out += map.get(ch);
      n++;
    } else {
      out += ch;
    }
  }

  if (n > 0) {
    fs.writeFileSync(file, out, "utf8");
    files++;
    replacements += n;
    console.log(`${n}\t${path.relative(root, file)}`);
  }
}

console.log(`\nReplaced ${replacements} chars in ${files} files.`);
