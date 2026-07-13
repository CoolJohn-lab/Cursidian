---
name: wiki-slop
description: >
  Run LLM-slop checks and auto-fixes on the Cursidian repo and/or the Obsidian wiki vault.
  Use when the user says "deslop", "slop check", "slop:fix", "remove slop", "clean emojis",
  "fix em dashes", "run slop on the wiki", or when npm run build fails on prebuild/slop:check.
  Also use after large wiki ingests or doc/skill edits that may have introduced AI typography.
---

# Wiki Slop - Deslop Repo and Vault

Strip AI typography and decorative emoji. **Vault deslop is MCP-only** via `user-cursidian` (`vault` `slop_check` / `deslop`). Repo deslop stays on npm scripts (build gate). Prefer these over ad-hoc `llm-slop` CLI flags.

Work from the **Cursidian repo root** for npm repo commands. Vault path is whatever the MCP server already uses (`OBSIDIAN_VAULT_PATH`).

## Commands / tools

| Intent | How |
|--------|-----|
| Check this repo | `npm run slop:check` |
| Auto-fix this repo | `npm run slop:fix` |
| Check the wiki vault | `vault` `action: "slop_check"` on `user-cursidian` |
| Auto-fix the wiki vault | `vault` `action: "deslop"` with `dryRun: true` first, then `confirm: true` |
| Compile MCP | `npm run build` (runs repo `slop:check` via `prebuild`) |

CLI `npm run slop:check:wiki` / `slop:fix:wiki` remain for humans/CI but **agents must not** use them for vault writes (bypasses journals/undo and historically missed frontmatter).

## Workflow

1. **Decide scope**
   - User said wiki / vault / Memories -> MCP `slop_check` / `deslop`
   - User said repo / MCP package / build / `skills/wiki` in the package -> npm repo scripts
   - Unclear after a mixed doc session -> vault via MCP if they care about notes, else repo; ask only if both are likely dirty
2. **Vault cleanup (MCP)**
   - `vault` `slop_check` - read-only report (body + frontmatter string fields + emoji)
   - Prefer `deslop` with `dryRun: true`, then `deslop` with `confirm: true`
   - Push returned `operationId` onto the operation stack; undo with `vault` `undo` on failure
   - `deslop` is one vault call (server-side multi-file journal); do not parallel it with other same-path vault mutations. For leftover **phrase** hits, serialize `note` updates one note at a time and chain response `revisionHash`
   - When `summariesChanged` / `indexSynced` is true, catalogs are already rebuilt inside `deslop`; otherwise run `vault` `sync_index` if you still see index drift
   - Re-check with `slop_check` and optionally `vault` `health` (expect zero `summaryMismatches`)
3. **Repo cleanup (npm)**
   - Prefer `slop:fix` then `slop:check`
4. **If check fails after fix**
   - Character/emoji hits should be gone after `deslop` / `slop:fix`
   - Remaining **phrase** hits need a manual rewrite via `note` `read` -> `update` `patch` (no auto-replace). Reword, re-run check
   - Do not disable packs casually; rewrite the prose or ask the user before severity-overrides
5. **Build gate** - If `npm run build` fails on `slop:check`, run `npm run slop:fix`, clear leftover phrases, then build again
6. **Do not** run vault `deslop` with `confirm: true` unless the user asked to clean the vault

## What it catches

- Unicode typography: em/en dashes, curly quotes, ellipsis, arrows, bullets (note **body** and **frontmatter** string fields including `summary`)
- Decorative emoji (`Extended_Pictographic`; keeps (c)(r)TM)
- Phrase packs: `claudeisms`, `structural`, `puffery`, plus custom phrases in `.llmsloprc.json` (report only)
- Vault scan skips `.obsidian`, `.trash`, `.cursidian-trash`

## Config (Cursidian package)

- `.llmsloprc.json` - char/phrase rules (includes generated emoji ban list); shipped with the npm package
- `.vscode/settings.json` - `llmSlopDetector.enabledPacks`
- MCP: `src/lib/slop.ts` + `vault` `slop_check` / `deslop`
- Repo scripts: `scripts/slop-lib.mjs` / `slop-check.mjs` / `fix-slop.mjs`
- Regenerate emoji rules: `node scripts/generate-emoji-rules.mjs`

## Report back

Summarize: scope (repo vs wiki), files fixed / `operationId`, any leftover phrase findings with paths, whether `slop_check` / repo `slop:check` is clean, and whether `vault` `health` index drift is clear.
