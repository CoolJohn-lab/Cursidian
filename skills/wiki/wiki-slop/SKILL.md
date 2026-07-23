---
name: wiki-slop
description: >
  Run LLM-slop checks and auto-fixes on the Obsidian wiki vault via user-cursidian
  MCP only (vault slop_check / deslop). Use when the user says deslop/slop on the
  wiki or vault, clean wiki emojis/em dashes, or after large ingests that may have
  introduced AI typography. For repos or ~/.cursor on disk, use skill slop instead.
---

# Wiki Slop (vault / MCP)

Strip AI typography and decorative emoji from the **Obsidian wiki vault**.

**Vault deslop is MCP-only** via `user-cursidian` (`vault` `slop_check` / `deslop`).
Agents must **not** use filesystem tools or `npm run slop:*:wiki` for vault writes
(bypasses journals/undo; historically missed frontmatter).

Local disk (cursor-global, DLZ, other repos) -> skill **`slop`** + `~/.cursor/skills/slop/scripts/deslop.mjs` (package: `skills/wiki/slop/`; wiki SoT: `skills/local-deslop`).

Vault path is whatever the MCP server already uses (`OBSIDIAN_VAULT_PATH`).

## Commands / tools

| Intent                       | How                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Check the wiki vault         | `vault` `action: "slop_check"` on `user-cursidian`                                   |
| Auto-fix the wiki vault      | `vault` `action: "deslop"` with `dryRun: true` first, then `confirm: true`           |
| Local repo / cursor-global   | skill **`slop`** (not this skill)                                                    |
| Cursidian package build gate | In that repo: `npm run slop:check` / `slop:fix` (or skill `slop --preset cursidian`) |

CLI `npm run slop:check:wiki` / `slop:fix:wiki` remain for humans/CI but **agents
must not** use them for vault writes.

## Workflow

1. **Confirm scope** is the wiki/vault. If they meant a repo or `~/.cursor`, hand off to `slop`.
2. `vault` `slop_check` -- read-only report (body + frontmatter string fields + emoji).
3. Prefer `deslop` with `dryRun: true`, then `deslop` with `confirm: true` (only when the user asked to clean the vault).
4. Push returned `operationId` onto the operation stack; undo with `vault` `undo` on failure.
5. `deslop` is one vault call (server-side multi-file journal); do not parallel it with other same-path vault mutations. For leftover **phrase** hits, serialize `note` updates one note at a time and chain response `revisionHash`.
6. When `summariesChanged` / `indexSynced` is true, index blurbs are already updated inside `deslop`; otherwise run `vault` `sync_index` if you still see real index drift (respect `indexMode`).
7. Re-check with `slop_check` and optionally `vault` `health` (expect zero `summaryMismatches`).

## What it catches

- Unicode typography: em/en dashes, curly quotes, ellipsis, arrows, bullets (note **body** and **frontmatter** string fields including `summary`)
- Decorative emoji (`Extended_Pictographic`; keeps (c)(r)TM)
- Phrase packs: `claudeisms`, `structural`, `puffery`, `security`, plus custom phrases in Cursidian `.cursidian-slop.json` (report only)
- Vault scan skips `.obsidian`, `.trash`, `.cursidian-trash`

## Config (Cursidian package -- reference)

- `.cursidian-slop.json` -- local typography/phrase extras; packs under `rules/slop/packs/`
- First-party engine: `src/lib/slop-engine/` (used by MCP `src/lib/slop.ts` and `npm run slop:*`)
- MCP: `vault` `slop_check` / `deslop`
- Repo scripts exist for the **package** build gate; vault writes stay on MCP

## Report back

`operationId`, files fixed, leftover phrase findings with paths, whether `slop_check` is clean, and whether `vault` `health` index drift is clear.
