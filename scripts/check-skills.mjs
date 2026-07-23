#!/usr/bin/env node
/**
 * Static contract checks over skills/wiki skill SKILL.md files.
 *
 * Catches retired tool names, unsafe _raw listing, phantom health fields,
 * missing operation-stack / replaceAll guidance, filesystem vault access,
 * and writes inside nominally read-only modes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_NAMES } from './skill-names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(repoRoot, 'skills', 'wiki');

const MUTATING_SKILLS = [
  'wiki-setup',
  'wiki-ingest',
  'wiki-capture',
  'wiki-update',
  'wiki-lint',
  'wiki-slop',
];

const LEGACY_TOOL_RE =
  /\b(read_note|search_content|get_note_neighborhood|get_backlinks|touch_wiki_meta|create_note|update_note|list_notes|list_recent|list_tags|search_by_tags|manage_frontmatter|manage_folders|delete_note|rename_note|vault_health)\b/;

/** Health fields that are not returned by vault health. */
const PHANTOM_HEALTH_RE =
  /(?:vault[`'"]?\s*(?:action\s*)?[`'"]?health|health report)[\s\S]{0,400}\bContradictions\b/i;

const FS_VAULT_ACCESS_RE =
  /\b(?:use|using|via|call|with)\s+(?:Read|Write|StrReplace|Grep|Glob)\b[\s\S]{0,120}\b(?:index\.md|_meta\/|_raw\/)/i;

const VAULT_SHELL_WRITE_RE =
  /\b(?:run|execute|use)\s+(?:cat|sed|mkdir|mv|rm)\b[\s\S]{0,80}\b(?:index\.md|_meta\/|_raw\/)/i;

function readSkill(name) {
  const file = path.join(skillsRoot, name, 'SKILL.md');
  if (!fs.existsSync(file)) {
    return { file, text: null };
  }
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function rel(file) {
  return path.relative(repoRoot, file).replace(/\\/g, '/');
}

function checkRawListing(name, text, problems) {
  // Flag folder: "_raw" without includeOperational: true in the same skill.
  const mentionsRawList =
    /folder:\s*["']_raw["']/.test(text) ||
    /`folder:\s*"_raw"`/.test(text) ||
    /folder:\s*"_raw"/.test(text);
  if (!mentionsRawList) return;
  if (!/includeOperational:\s*true/.test(text)) {
    problems.push(
      `${name}: lists _raw/ without includeOperational: true (operational notes are excluded by default)`,
    );
  }
}

function checkOperationStack(name, text, problems) {
  if (!MUTATING_SKILLS.includes(name)) return;
  if (!/operationStack|operation-ID stack|operation stack/i.test(text)) {
    problems.push(`${name}: mutating skill missing operation-stack instructions`);
  }
}

function checkWriteSequencing(name, text, problems) {
  if (!MUTATING_SKILLS.includes(name)) return;
  const hasSequencing =
    /one note at a time|serialize per path|same-path|read immediately before each write|chain(?:ing)? (?:the )?(?:response )?revision/i.test(
      text,
    );
  if (!hasSequencing) {
    problems.push(
      `${name}: mutating skill missing same-path serialization / revision-chaining guidance`,
    );
  }
}

function checkWriteScopeAnnouncement(name, text, problems) {
  if (name !== 'wiki-update' && name !== 'wiki-ingest') return;
  if (!/announce(?: the)? (?:write )?scope|planned path list|paths about to/i.test(text)) {
    problems.push(`${name}: missing write-scope announcement before first mutation`);
  }
}

function checkLlmWikiCallHygiene(text, problems) {
  const hasToolName =
    /toolName/.test(text) && (/user-cursidian/.test(text) || /CallMcpTool|GetMcpTools/.test(text));
  if (!hasToolName) {
    problems.push('vault: missing CallMcpTool hygiene (server user-cursidian + toolName)');
  }
  if (
    !/one note at a time|serialize per path|same-path|read immediately before each write/i.test(
      text,
    )
  ) {
    problems.push('vault: missing same-path / one-note write sequencing language');
  }
}

function checkReplaceAllGuidance(name, text, problems) {
  // Skills that instruct frontmatter set should mention replaceAll.
  const usesFmSet =
    /fmOperation:\s*["']set["']/.test(text) ||
    /fmOperation`?\s+set\b/i.test(text) ||
    /frontmatter[^.\n]{0,40}\bset\b/i.test(text);
  if (!usesFmSet) return;
  // vault tool map is enough as shared guidance when skill only says merge.
  if (name === 'vault') return;
  if (/replaceAll/.test(text)) return;
  // Allow merge-only skills (prefer merge) without replaceAll.
  if (/fmOperation:\s*["']merge["']/.test(text) && !/fmOperation:\s*["']set["']/.test(text)) {
    return;
  }
  problems.push(`${name}: mentions frontmatter set without replaceAll guidance`);
}

function checkReadOnlyZeroWrites(name, text, problems) {
  if (name === 'wiki-query') {
    const hasWrite =
      /action:\s*["'](?:create|update|delete|rename|frontmatter)["']/.test(text) ||
      /`vault`[^.\n]{0,40}(?:sync_index|undo|manifest)/.test(text);
    // Allow pointing users at other skills; forbid instructing writes in this skill's protocol.
    if (/## This skill is read-only[\s\S]*?## Protocol([\s\S]*?)## Answer format/.test(text)) {
      const protocol = RegExp.$1;
      if (
        /action:\s*["'](?:create|update|delete|rename)["']/.test(protocol) ||
        /vault[`'"]?\s+action[`'"]?:\s*["'](?:sync_index|undo)["']/.test(protocol)
      ) {
        problems.push(`${name}: protocol section instructs vault writes`);
      }
    }
    if (!/read-only/i.test(text)) {
      problems.push(`${name}: missing explicit read-only declaration`);
    }
    void hasWrite;
  }

  if (name === 'wiki-lint') {
    if (!/Report-only mode[\s\S]{0,400}Zero writes/i.test(text)) {
      problems.push(`${name}: report-only mode must state zero writes`);
    }
  }
}

function main() {
  const problems = [];

  if (!fs.existsSync(skillsRoot)) {
    console.error(`Skills root missing: ${skillsRoot}`);
    process.exit(1);
  }

  for (const name of SKILL_NAMES) {
    const { file, text } = readSkill(name);
    if (!text) {
      problems.push(`${name}: missing SKILL.md at ${rel(file)}`);
      continue;
    }

    const legacy = text.match(LEGACY_TOOL_RE);
    if (legacy) {
      problems.push(`${rel(file)}: legacy tool name "${legacy[1]}"`);
    }

    if (PHANTOM_HEALTH_RE.test(text)) {
      problems.push(`${rel(file)}: phantom Contradictions field tied to vault health`);
    }

    if (FS_VAULT_ACCESS_RE.test(text)) {
      problems.push(`${rel(file)}: appears to instruct filesystem tools on vault paths`);
    }

    if (VAULT_SHELL_WRITE_RE.test(text)) {
      problems.push(`${rel(file)}: appears to instruct shell mutation of vault paths`);
    }

    // Disk-only `slop` and vault-only `wiki-slop` have specialised contracts.
    if (
      name !== 'wiki-slop' &&
      name !== 'slop' &&
      !/user-cursidian|MCP Contract|MCP-only/i.test(text)
    ) {
      problems.push(`${rel(file)}: missing MCP contract / user-cursidian reference`);
    }
    if (name === 'wiki-slop') {
      if (!/slop_check|deslop/i.test(text)) {
        problems.push(`${rel(file)}: wiki-slop must document vault slop_check / deslop`);
      }
      if (!/user-cursidian|MCP-only|MCP only/i.test(text)) {
        problems.push(`${rel(file)}: wiki-slop must require MCP for vault deslop`);
      }
    }
    if (name === 'slop') {
      if (!/deslop\.mjs/.test(text)) {
        problems.push(`${rel(file)}: slop must document scripts/deslop.mjs`);
      }
      if (!/wiki-slop/.test(text)) {
        problems.push(`${rel(file)}: slop must route vault targets to wiki-slop`);
      }
      const helper = path.join(skillsRoot, 'slop', 'scripts', 'deslop.mjs');
      if (!fs.existsSync(helper)) {
        problems.push('slop: missing scripts/deslop.mjs helper');
      }
    }

    checkRawListing(name, text, problems);
    checkOperationStack(name, text, problems);
    checkWriteSequencing(name, text, problems);
    checkWriteScopeAnnouncement(name, text, problems);
    checkReplaceAllGuidance(name, text, problems);
    checkReadOnlyZeroWrites(name, text, problems);
  }

  // Shared contract must document undo/history/manifest and revisionHash.
  const { text: llmWiki } = readSkill('vault');
  if (llmWiki) {
    checkLlmWikiCallHygiene(llmWiki, problems);
    for (const token of [
      'history',
      'undo',
      'manifest',
      'revisionHash',
      'expectedRevision',
      'operationStack',
    ]) {
      if (!llmWiki.includes(token) && token !== 'operationStack') {
        // operationStack may be written as "operation-ID stack"
        if (token === 'operationStack' && /operation-ID stack|operation stack/i.test(llmWiki)) {
          continue;
        }
        if (token === 'operationStack') continue;
        problems.push(`vault: missing required contract token "${token}"`);
      }
    }
    if (!/operation-ID stack|operationStack|operation stack/i.test(llmWiki)) {
      problems.push('vault: missing operation stack rollback protocol');
    }
  }

  if (problems.length > 0) {
    console.error('skills:check failed:\n');
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }

  console.log(`skills:check - clean (${SKILL_NAMES.length} skills)`);
}

main();
