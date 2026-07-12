---
name: wiki-slop
description: >
  Run LLM-slop checks and auto-fixes on the Cursidian repo and/or the Obsidian wiki vault.
  Use when the user says "deslop", "slop check", "slop:fix", "remove slop", "clean emojis",
  "fix em dashes", "run slop on the wiki", or when npm run build fails on prebuild/slop:check.
  Also use after large wiki ingests or doc/skill edits that may have introduced AI typography.
---

# Wiki Slop - Deslop Repo and Vault

Strip AI typography and decorative emoji using the Cursidian npm scripts. Prefer these scripts over ad-hoc `llm-slop` CLI flags (packs, vault path, and `.llmsloprc.json` are already wired).

Work from the **Cursidian repo root** (`Cursidian/`). Vault path comes from `OBSIDIAN_VAULT_PATH` or `~/.cursor/mcp.json`.

## Commands

| Intent | Command |
|--------|---------|
| Check this repo | `npm run slop:check` |
| Auto-fix this repo | `npm run slop:fix` |
| Check the wiki vault | `npm run slop:check:wiki` |
| Auto-fix the wiki vault | `npm run slop:fix:wiki` |
| Compile MCP | `npm run build` (runs `slop:check` via `prebuild`) |

## Workflow

1. **Decide scope**
   - User said wiki / vault / Memories -> wiki scripts (`*:wiki`)
   - User said repo / MCP / build / skills under `skills/wiki` in the package -> repo scripts
   - Unclear after a mixed doc session -> run **wiki** if they care about notes, else **repo**; ask only if both are likely dirty
2. **Prefer fix then check** when the user wants cleanup: `slop:fix` / `slop:fix:wiki`, then the matching `slop:check`
3. **If check fails after fix**
   - Character/emoji hits should be gone after `slop:fix`
   - Remaining **phrase** hits need a manual rewrite (no auto-replace). Open the file, reword, re-run check
   - Do not disable packs casually; rewrite the prose or ask the user before severity-overrides
4. **Build gate** - If `npm run build` fails on `slop:check`, run `npm run slop:fix`, clear leftover phrases, then build again
5. **Do not** run `slop:fix:wiki` unless the user asked to clean the vault (it rewrites many notes)

## What it catches

- Unicode typography: em/en dashes, curly quotes, ellipsis, arrows, bullets
- Decorative emoji (`Extended_Pictographic`; keeps (c)(r)TM)
- Phrase packs: `claudeisms`, `structural`, `puffery`, plus custom phrases in `.llmsloprc.json`
- Wiki scan skips `.obsidian`, `.trash`, `.cursidian-trash`

## Config (Cursidian repo)

- `.llmsloprc.json` - char/phrase rules (includes generated emoji ban list)
- `.vscode/settings.json` - `llmSlopDetector.enabledPacks`
- `scripts/slop-lib.mjs` / `slop-check.mjs` / `fix-slop.mjs`
- Regenerate emoji rules: `node scripts/generate-emoji-rules.mjs`

## Report back

Summarize: scope (repo vs wiki), files fixed, any leftover phrase findings with paths, and whether `slop:check` / `slop:check:wiki` is clean.
