#!/usr/bin/env node
/**
 * deslop.mjs v2.0.0
 * Conservative LLM-typography and decorative-emoji checker/fixer.
 * Built-in operation has no npm dependencies. Node.js >=20 is required.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const VERSION = "2.0.0";
const SCHEMA = "deslop/v2";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DETECTOR_TIMEOUT_MS = 60_000;
const DETECTOR_MAX_BUFFER = 16 * 1024 * 1024;
const PROSE_EXTS = new Set([".md", ".mdc", ".mdx", ".markdown", ".mdown", ".mkd", ".txt", ".rst"]);
const CODE_EXTS = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".scala", ".sql", ".yml", ".yaml", ".json", ".jsonc", ".toml", ".sh", ".bash", ".zsh", ".ps1", ".html", ".css"]);
const DEFAULT_EXCLUDES = ["node_modules", ".git", ".hg", ".svn", "__pycache__", ".venv", "venv", "dist", "build", "out", "coverage", ".terraform", ".next", ".turbo", ".cache", "vendor", "framework", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", ".llmsloprc.json", ".cursidian-slop.json", "rules/slop"];
const CURSOR_EXCLUDES = ["skills-cursor", "plugins/cache", "projects", "agent-transcripts", "ai-tracking", "browser-logs", "extensions", "CachedProfilesData", "CachedExtensionVSIXs", "User/globalStorage", "User/workspaceStorage", "User/History", "logs", "terminals"];

const SAFE_MAP = new Map([
  ["\u2010", "-"], ["\u2011", "-"], ["\u2012", "-"], ["\u2013", "-"], ["\u2014", "-"], ["\u2015", "-"],
  ["\u2018", "'"], ["\u2019", "'"], ["\u201A", "'"], ["\u201B", "'"], ["\u2039", "'"], ["\u203A", "'"],
  ["\u201C", "\""], ["\u201D", "\""], ["\u201E", "\""], ["\u201F", "\""], ["\u00AB", "\""], ["\u00BB", "\""],
  ["\u2026", "..."]
]);
const AGGRESSIVE_MAP = new Map([
  ["\u2192", "->"], ["\u2190", "<-"], ["\u2194", "<->"], ["\u21D2", "=>"],
  ["\u2022", "*"], ["\u2023", "*"], ["\u25E6", "*"], ["\u2043", "-"], ["\u00B7", "*"],
  ["\u2212", "-"], ["\u00D7", "x"], ["\u2044", "/"], ["\u2032", "'"], ["\u2033", "\""],
  ["\u00A0", " "], ["\u202F", " "], ["\u2007", " "], ["\u2009", " "], ["\u200A", " "], ["\u3000", " "]
]);
const PROTECTED_PICTOGRAPHS = new Set(["\u00A9", "\u00AE", "\u2122"]);
const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)/gu;

function usage() {
  console.log(`deslop ${VERSION}\nUsage: node deslop.mjs <check|fix> [paths...] [options]\n\nOptions:\n  --preset cursor-global|cursidian\n  --engine auto|builtin|cursidian\n  --cursidian PATH\n  --strip-emoji\n  --aggressive\n  --include-code\n  --scan-comments       Deprecated alias for --include-code\n  --exclude NAME        Repeatable basename or relative POSIX path\n  --dry-run\n  --diff                Implies --dry-run\n  --backup\n  --json\n  --pack LIST\n  -h, --help\n  --version\n\nExit: 0 clean, 1 findings remain, 2 usage/operational failure.\n\nNote: --engine cursidian uses Cursidian's first-party slop engine (not llm-slop-detector).`);
}
function fail(message, json = false, errors = []) {
  if (json) console.log(JSON.stringify({ schema: SCHEMA, version: VERSION, status: "incomplete", exitCode: 2, summary: null, findings: [], errors: [...errors, { code: "fatal", message }] }, null, 2));
  else console.error(`deslop: ${message}`);
  process.exit(2);
}
function posixRel(p) { return p.split(path.sep).join("/").replace(/^\.\//, ""); }
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
function realExisting(p) { return fs.realpathSync.native(path.resolve(p)); }
function decodeUtf8(buffer) { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer); }
function lineCol(text, index) {
  let line = 1, col = 1;
  for (const ch of text.slice(0, index)) ch === "\n" ? (line++, col = 1) : col++;
  return { line, col };
}
function addEdit(edits, start, end, replacement, code, original) {
  edits.push({ start, end, replacement, code, original });
}
function analyse(text, opts) {
  const edits = [];
  if (text.charCodeAt(0) === 0xFEFF) addEdit(edits, 0, 1, "", "bom", "\\uFEFF");
  const map = opts.aggressive ? new Map([...SAFE_MAP, ...AGGRESSIVE_MAP]) : SAFE_MAP;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i); const ch = String.fromCodePoint(cp);
    if (map.has(ch)) addEdit(edits, i, i + ch.length, map.get(ch), "typography", ch);
    i += ch.length;
  }
  if (opts.stripEmoji) {
    EMOJI_RE.lastIndex = 0;
    for (const m of text.matchAll(EMOJI_RE)) {
      if ([...m[0]].every(ch => PROTECTED_PICTOGRAPHS.has(ch) || ch === "\uFE0F")) continue;
      addEdit(edits, m.index, m.index + m[0].length, "", "emoji", m[0]);
    }
  }
  edits.sort((a,b) => a.start - b.start || a.end - b.end);
  const accepted = [];
  for (const e of edits) {
    const prev = accepted.at(-1);
    if (prev && e.start < prev.end) continue;
    accepted.push(e);
  }
  return accepted.map(e => ({ ...e, ...lineCol(text, e.start) }));
}
function applyEdits(text, edits) {
  let out = "", cursor = 0;
  for (const e of edits) { out += text.slice(cursor, e.start) + e.replacement; cursor = e.end; }
  return out + text.slice(cursor);
}
function displayFinding(file, e) { return { path: file, code: e.code, line: e.line, col: e.col, original: e.original, replacement: e.replacement, message: `${e.code}: ${JSON.stringify(e.original)} -> ${JSON.stringify(e.replacement)}` }; }

function allVaultCandidates() {
  const out = [];
  if (process.env.OBSIDIAN_VAULT_PATH) out.push(process.env.OBSIDIAN_VAULT_PATH);
  const mcp = path.join(os.homedir(), ".cursor", "mcp.json");
  if (fs.existsSync(mcp)) {
    let data;
    try { data = JSON.parse(fs.readFileSync(mcp, "utf8")); }
    catch (e) { throw new Error(`cannot parse ${mcp}: ${e.message}`); }
    for (const server of Object.values(data?.mcpServers || {})) if (server?.env?.OBSIDIAN_VAULT_PATH) out.push(server.env.OBSIDIAN_VAULT_PATH);
  }
  return [...new Set(out.map(p => path.resolve(p)).filter(fs.existsSync).map(realExisting))];
}
function excluded(relative, base, rules) {
  const rel = posixRel(relative); const parts = rel.split("/");
  return rules.some(raw => {
    const r = String(raw).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    return r.includes("/") ? (rel === r || rel.startsWith(`${r}/`)) : (base === r || parts.includes(r));
  });
}
function discover(roots, opts, vaults) {
  const files = new Set(), errors = [], prunedVaults = [];
  const wanted = new Set([...PROSE_EXTS, ...(opts.includeCode ? CODE_EXTS : [])]);
  function visit(p, rootReal) {
    let st;
    try { st = fs.lstatSync(p); } catch (e) { errors.push({ path:p, code:"stat", message:e.message }); return; }
    if (st.isSymbolicLink()) { errors.push({ path:p, code:"symlink", message:"symlinks are not scanned" }); return; }
    let real;
    try { real = realExisting(p); } catch (e) { errors.push({ path:p, code:"realpath", message:e.message }); return; }
    if (vaults.some(v => isInside(real, v))) { prunedVaults.push(real); return; }
    const rel = path.relative(rootReal, real);
    if (rel && excluded(rel, path.basename(real), opts.excludes)) return;
    if (st.isDirectory()) {
      let entries; try { entries = fs.readdirSync(real, { withFileTypes:true }); } catch (e) { errors.push({ path:real, code:"readdir", message:e.message }); return; }
      for (const ent of entries) visit(path.join(real, ent.name), rootReal);
    } else if (st.isFile()) {
      if (wanted.has(path.extname(real).toLowerCase())) files.add(real);
    }
  }
  for (const raw of roots) {
    const abs = path.resolve(raw);
    if (!fs.existsSync(abs)) { errors.push({ path:abs, code:"missing", message:"path does not exist" }); continue; }
    let lst; try { lst = fs.lstatSync(abs); } catch (e) { errors.push({ path:abs, code:"stat", message:e.message }); continue; }
    if (lst.isSymbolicLink()) { errors.push({ path:abs, code:"symlink-root", message:"explicit symlink roots are refused" }); continue; }
    const rr = realExisting(abs);
    if (vaults.some(v => isInside(rr, v))) { errors.push({ path:rr, code:"vault", message:"target is inside a configured Obsidian vault" }); continue; }
    visit(rr, rr);
  }
  return { files:[...files].sort(), errors, prunedVaults:[...new Set(prunedVaults)] };
}
function readSnapshot(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error("not a regular file");
    if (st.size > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES} bytes`);
    const buffer = Buffer.alloc(st.size); let off = 0;
    while (off < buffer.length) { const n = fs.readSync(fd, buffer, off, buffer.length-off, off); if (!n) break; off += n; }
    if (off !== st.size) throw new Error("file changed while reading");
    return { text:decodeUtf8(buffer), stat:st };
  } finally { fs.closeSync(fd); }
}
function nextBackup(file) {
  for (let n=0;;n++) { const p = `${file}.deslop.bak${n ? `.${n}` : ""}`; if (!fs.existsSync(p)) return p; }
}
function atomicWrite(file, text, originalStat, backup) {
  const now = fs.statSync(file);
  if (now.dev !== originalStat.dev || now.ino !== originalStat.ino || now.size !== originalStat.size || now.mtimeMs !== originalStat.mtimeMs) throw new Error("file changed after it was read");
  let backupPath = null;
  if (backup) { backupPath = nextBackup(file); fs.copyFileSync(file, backupPath, fs.constants.COPYFILE_EXCL); fs.chmodSync(backupPath, originalStat.mode); }
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.deslop-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`);
  try { fs.writeFileSync(temp, text, { encoding:"utf8", mode:originalStat.mode, flag:"wx" }); fs.renameSync(temp, file); }
  catch (e) { try { fs.rmSync(temp, { force:true }); } catch {} throw e; }
  return backupPath;
}
function simpleDiff(file, before, after) {
  const a=before.split(/(?<=\n)/), b=after.split(/(?<=\n)/), rows=[`--- ${file}`, `+++ ${file}`];
  const n=Math.max(a.length,b.length);
  for(let i=0;i<n;i++) if(a[i]!==b[i]) { rows.push(`@@ line ${i+1} @@`); if(a[i]!==undefined) rows.push(`-${a[i].replace(/\n$/,"")}`); if(b[i]!==undefined) rows.push(`+${b[i].replace(/\n$/,"")}`); }
  return rows.join("\n");
}

function resolveCursidian(rootArg, required) {
  const raw = rootArg || process.env.CURSIDIAN_ROOT;
  if (!raw) { if (required) throw new Error("cursidian engine requires --cursidian PATH or CURSIDIAN_ROOT"); return null; }
  const root = realExisting(raw);
  const configCandidates = [".cursidian-slop.json", ".llmsloprc.json"].map((n) => path.join(root, n));
  const configPath = configCandidates.find((p) => fs.existsSync(p));
  if (!configPath) throw new Error(`missing .cursidian-slop.json under ${root}`);
  const config = realExisting(configPath);
  const scanner = path.join(root, "scripts", "slop-scan-files.mjs");
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(scanner)) throw new Error(`missing ${scanner}`);
  if (!fs.existsSync(tsxCli)) throw new Error(`missing tsx at ${tsxCli} (run npm install in Cursidian)`);
  if (!isInside(config, root) || !isInside(scanner, root)) throw new Error("cursidian config/scanner escapes trusted Cursidian root");
  return { root, config, scanner, tsxCli };
}
function validateCursidianFinding(f, allow) {
  if (!f || typeof f !== "object" || typeof f.path !== "string" || typeof f.code !== "string" || typeof f.message !== "string") return null;
  let rp; try { rp = realExisting(f.path); } catch { return null; }
  if (!allow.has(rp)) return null;
  const line = Number.isInteger(f.line) && f.line > 0 ? f.line : null;
  const col = Number.isInteger(f.col) && f.col > 0 ? f.col : null;
  return { path:rp, code:`cursidian:${f.code}`, line, col, message:f.message, reportOnly:true };
}
function runCursidian(cursidian, files, packs, includeCode) {
  const findings=[], allow=new Set(files.map(realExisting));
  const batches=[]; let current=[], len=0;
  for (const f of files) { if (current.length && len+f.length>20_000) { batches.push(current); current=[]; len=0; } current.push(f); len+=f.length+1; } if(current.length) batches.push(current);
  for (const batch of batches) {
    const args=[cursidian.tsxCli, cursidian.scanner, "--pack", packs, ...batch];
    if(includeCode) args.splice(2,0,"--scan-comments");
    const r=spawnSync(process.execPath,args,{encoding:"utf8",timeout:DETECTOR_TIMEOUT_MS,maxBuffer:DETECTOR_MAX_BUFFER,cwd:cursidian.root});
    if(r.error) throw new Error(`cursidian slop scan failed: ${r.error.message}`);
    // exits 0 (clean) or 1 (findings); other statuses/signals are failures.
    if(r.signal || (r.status!==0 && r.status!==1)) throw new Error(`cursidian slop scan exited ${r.status ?? r.signal}: ${(r.stderr||"").slice(0,1000)}`);
    let data; try { data=JSON.parse(r.stdout||"[]"); } catch(e) { throw new Error(`invalid cursidian slop JSON: ${e.message}`); }
    const rows=Array.isArray(data)?data:data?.findings;
    if(!Array.isArray(rows)) throw new Error("cursidian slop JSON has no findings array");
    for(const row of rows) { const v=validateCursidianFinding(row,allow); if(!v) throw new Error("cursidian returned an invalid or out-of-scope finding"); findings.push(v); }
  }
  return findings;
}

function preset(name, cursidian) {
  if(name==="cursor-global") { const candidates=[path.join(os.homedir(),".cursor","skills"),path.join(os.homedir(),".cursor","plugins","local"),path.join(os.homedir(),".cursor","my-agents"),path.join(os.homedir(),".cursor","rules"),path.join(os.homedir(),".cursor","config")]; return { roots:candidates.filter(fs.existsSync), excludes:CURSOR_EXCLUDES }; }
  if(name==="cursidian") { const r=cursidian||process.env.CURSIDIAN_ROOT; if(!r) throw new Error("cursidian preset requires --cursidian PATH or CURSIDIAN_ROOT"); return {roots:[r],excludes:[]}; }
  throw new Error(`unknown preset ${JSON.stringify(name)}`);
}
function requireNode20() {
  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  if (!Number.isFinite(major) || major < 20) {
    fail(`Node.js 20+ required (found ${process.versions.node})`);
  }
}

function main() {
  requireNode20();
  let parsed;
  try { parsed=parseArgs({args:process.argv.slice(2),allowPositionals:true,strict:true,options:{preset:{type:"string"},engine:{type:"string",default:"auto"},cursidian:{type:"string"},"strip-emoji":{type:"boolean",default:false},aggressive:{type:"boolean",default:false},"include-code":{type:"boolean",default:false},"scan-comments":{type:"boolean",default:false},exclude:{type:"string",multiple:true,default:[]},"dry-run":{type:"boolean",default:false},diff:{type:"boolean",default:false},backup:{type:"boolean",default:false},json:{type:"boolean",default:false},pack:{type:"string",default:"claudeisms,structural,puffery,security"},help:{type:"boolean",short:"h",default:false},version:{type:"boolean",default:false}}}); }
  catch(e) { fail(`bad arguments: ${e.message}`); }
  const {values:v,positionals:p}=parsed;
  if(v.version){console.log(VERSION);return;} if(v.help){usage();return;}
  const cmd=p[0]; if(!["check","fix"].includes(cmd)) fail("first argument must be check or fix",v.json);
  const engine = v.engine === "detector" ? "cursidian" : v.engine;
  if(!["auto","builtin","cursidian"].includes(engine)) fail("--engine must be auto, builtin or cursidian",v.json);
  if(v.backup && (cmd!=="fix" || v["dry-run"] || v.diff)) fail("--backup requires a writing fix and cannot be combined with --dry-run/--diff",v.json);
  const includeCode=v["include-code"]||v["scan-comments"]; const dryRun=cmd==="fix"&&(v["dry-run"]||v.diff);
  if(v["scan-comments"]&&!v.json) console.error("deslop: warning: --scan-comments is deprecated; it includes whole code files. Use --include-code.");
  let roots=p.slice(1), excludes=[...DEFAULT_EXCLUDES,...v.exclude];
  try { if(v.preset){const x=preset(v.preset,v.cursidian);roots=[...x.roots,...roots];excludes=[...excludes,...x.excludes];} } catch(e){fail(e.message,v.json);}
  if(!roots.length) fail("pass at least one existing path or a preset with an existing root",v.json);
  let vaults; try{vaults=allVaultCandidates();}catch(e){fail(e.message,v.json);}
  const found=discover(roots,{includeCode,excludes},vaults); const errors=[...found.errors];
  const options={aggressive:v.aggressive,stripEmoji:v["strip-emoji"]}; const snapshots=new Map(); const builtin=[]; const proposed=[]; const written=[]; const backups=[]; const diffs=[];
  for(const file of found.files){
    let snap; try{snap=readSnapshot(file);}catch(e){errors.push({path:file,code:"read",message:e.message});continue;}
    snapshots.set(file,snap); const edits=analyse(snap.text,options); for(const e of edits) builtin.push(displayFinding(file,e));
    if(cmd==="fix"&&edits.length){const next=applyEdits(snap.text,edits);proposed.push(file);if(v.diff)diffs.push(simpleDiff(file,snap.text,next));if(!dryRun){try{const bp=atomicWrite(file,next,snap.stat,v.backup);written.push(file);if(bp)backups.push(bp);}catch(e){errors.push({path:file,code:"write",message:e.message});}}}
  }
  let cursidian=null,cursidianFindings=[];
  try { if(engine!=="builtin") cursidian=resolveCursidian(v.cursidian,engine==="cursidian"); if(cursidian) cursidianFindings=runCursidian(cursidian,[...snapshots.keys()],v.pack,includeCode); }
  catch(e){fail(e.message,v.json,errors);}
  let finalBuiltin=[];
  if(cmd==="fix"){
    for(const file of found.files){let text;if(dryRun&&snapshots.has(file)){const s=snapshots.get(file);text=applyEdits(s.text,analyse(s.text,options));}else{try{text=readSnapshot(file).text;}catch(e){errors.push({path:file,code:"rescan",message:e.message});continue;}}for(const e of analyse(text,options))finalBuiltin.push(displayFinding(file,e));}
  } else finalBuiltin=builtin;
  const findings=[...finalBuiltin,...cursidianFindings]; const incomplete=errors.length>0; const exitCode=incomplete?2:(findings.length?1:0); const status=incomplete?"incomplete":(findings.length?"findings":"clean");
  const result={schema:SCHEMA,version:VERSION,status,exitCode,command:cmd,policy:{engine,passes:["builtin",...(cursidian?["cursidian-report-only"]:[])],aggressive:v.aggressive,stripEmoji:v["strip-emoji"],includeCode,dryRun,backup:v.backup,cursidianRoot:cursidian?.root||null,cursidianConfig:cursidian?.config||null},summary:{roots:roots.map(r => path.resolve(r)),filesDiscovered:found.files.length,filesScanned:snapshots.size,proposedFiles:proposed.length,writtenFiles:written.length,remainingFindings:findings.length,cursidianFindings:cursidianFindings.length,errors:errors.length,prunedVaults:found.prunedVaults.length},findings,changes:{proposedFiles:proposed,writtenFiles:written,backups},errors,prunedVaults:found.prunedVaults};
  if(v.json)console.log(JSON.stringify(result,null,2));else{console.log(`deslop ${VERSION}: ${status}`);console.log(`files: discovered=${result.summary.filesDiscovered} scanned=${result.summary.filesScanned} proposed=${proposed.length} written=${written.length}`);console.log(`findings: ${findings.length} (cursidian ${cursidianFindings.length}); errors: ${errors.length}`);for(const f of findings)console.log(`${f.path}:${f.line??"?"}:${f.col??"?"} [${f.code}] ${f.message}`);for(const e of errors)console.error(`${e.path||"deslop"} [${e.code}] ${e.message}`);if(diffs.length)console.log(diffs.join("\n"));}
  process.exitCode=exitCode;
}
main();
