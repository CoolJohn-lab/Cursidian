# Cursidian

Implementation of the Obsidian llm-wiki concept for Cursor, using an MCP designed to minimise token consumption and maximise relevant results. Includes slop removal tools.

Getting Started:
- Download Obsidian, create an empty vault, make a note of its location.
- Install the "LLM Slop Detector" plugin in your Cursor (thias-se.llm-slop-detector)
- Install this MCP and the skills into your Cursor.
- Restart / Reload Cursor.
- Enter this prompt: "I have just created an empty obsidian vault at *vault location*, please set up my wiki there"

Let it do its thing, it will take about 5 minutes and burn like 30k tokens. Auto is fine, you don't need Claude for this! At this point you don't even need to be running Obsidian any more, the point of it was just to create the vault structure.

Once it is set up you can just ask Cursor agents for stuff like "create pages in my wiki about my project, as many as you need to capture everything." Or "refactor my ui to be more colourful, using the design notes in my wiki" etc. The sky is the limit. The more effort you ask agents to put into your wiki, the more you get out of it.

And notice the distinction there. the more effort *you ask your agents* to put in, you don't write this thing yourself. Have the Cursor agents do everything, they write the wiki, they read it, they lint it, check it and maintain it. You can dump entire ebooks into it, or have it review your most recent 100 cursor chat transcripts and save any relevant information it finds to your wiki. Optionally, ask it to "remove all slop from my wiki" once in a while.

You can dip in to read it using Obsidian whenever you like, but really its a resource for Cursor agents to store information about your projects, your goals, your design desisions and rules and so on.

## Credits
I took the "Obsidian Wiki" concept from Andrej Karpathy, and I drew inspiration from this existing Obsidian MCP: [@istrejo/obsidian-mcp](https://github.com/istrejo/obsidian-mcp). But really the credit goes to Fable, Grok and Composer 2.5, I am just their conductor, and I used Cursor to create this.

Anyway that's the end of the human-written portion of the readme, the rest is by Agents and for Agents really, but feel free to keep reading if you want. 

Emjoy! John.

## Features

- **4 MCP tools** - `note`, `search`, `graph`, `vault` (action-dispatch surface)
- **Safe writes** - `patch` inferred when `old_string`/`new_string` are set; `replace_section` for heading edits
- **Agent-friendly search** - default limit 10, compact format, stopwords stripped, token-AND with OR/typo fallback; hits include `title`/`summary`/`tags`
- **Auto timestamps** - `note` create/update/frontmatter set `created`/`updated` automatically
- **Optimistic concurrency** - `revisionHash` on read (full note), `expectedRevision` on write; `contentHash` / `expectedHash` remain as body-only / deprecated alias
- **Operation journals + undo** - mutating calls return `operationId`; `vault` `history` / `undo` reverse journaled work
- **Typed manifest** - `vault` `manifest` for `_meta/manifest.md` (no hand-edited ledger lines)
- **Signature-based caches** - index and search snapshots invalidate when files change on disk (including Obsidian edits)
- **Deslop gate** - `npm run build` runs `slop:check` first; strips AI typography and decorative emoji from the repo (and optionally the wiki vault)
- **Wiki skills** - nine Cursor skills that drive the MCP tools for ingest, query, lint, capture, update, status, and deslop
- **Skill contract gate** - `npm run skills:check` rejects retired tool names, phantom health fields, and read-only write leaks

## Tools

| Tool | Actions | Purpose |
|------|---------|---------|
| `note` | `read`, `create`, `update`, `delete`, `rename`, `frontmatter` | Note CRUD, safe edits, metadata; returns `revisionHash` / `operationId` |
| `search` | `content` (default), `by_tags`, `list`, `recent`, `tags` | Find and enumerate notes (paginated; may report `incomplete`) |
| `graph` | - | One-hop neighborhood (resolved + unresolved outgoing, paginated backlinks) |
| `vault` | `health`, `sync_index`, `create_folder`, `list_folders`, `delete_folder`, `log`, `history`, `undo`, `manifest` | Health, catalog, folders, bookkeeping, undo, ingest ledger |

## Requirements

- Node.js >= 20
- An **absolute** Obsidian vault path via `OBSIDIAN_VAULT_PATH`

## Quick start (published package)

Add to `~/.cursor/mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`):

```json
{
  "mcpServers": {
    "cursidian": {
      "command": "npx",
      "args": ["-y", "cursidian"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "C:\\Users\\you\\Documents\\MyVault"
      }
    }
  }
}
```

Unix:

```json
"OBSIDIAN_VAULT_PATH": "/Users/you/Documents/MyVault"
```

Reload Cursor. The config key `"cursidian"` appears as MCP server **`user-cursidian`**.

See also [`examples/cursor-mcp.json`](examples/cursor-mcp.json).

## Local development setup

```bash
git clone https://github.com/CoolJohn-lab/Cursidian.git
cd Cursidian
npm install
npm run build
npm test
```

Point Cursor at the built entrypoint:

```json
{
  "mcpServers": {
    "cursidian": {
      "command": "node",
      "args": ["/absolute/path/to/Cursidian/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault"
      }
    }
  }
}
```

## Wiki skills + MCP

Cursidian is a **two-layer** product:

| Layer | Role | Where |
|-------|------|-------|
| **MCP server** | Runtime vault I/O for agents | Published `cursidian` package / local `dist/` |
| **Wiki skills** | Workflow instructions (ingest, query, lint, ...) | [`skills/wiki/`](skills/wiki/) copied into `~/.cursor/skills/` |

The MCP server is the only way agents read or write vault markdown. Skills do **not** open vault files with the IDE filesystem tools or shell - they call **`user-cursidian`** (`note`, `search`, `graph`, `vault`). If an MCP call fails, the skill reports the failure and **stops** (no silent filesystem fallback).

Source documents **outside** the vault (PDFs, repo files, URLs) may be read with normal tools for ingest; the moment content enters the vault, it is MCP-only.

### How agents use both

1. Cursor loads skills from `~/.cursor/skills/` when the user asks something matching a skill description (e.g. "add this to the wiki", "what do I know about X").
2. The skill tells the agent which MCP actions to call, in what order (cheap search first, full `note` read only when needed).
3. Writes follow the safe-write protocol: `note` `read` -> `revisionHash` -> narrowest `note` `update` with `expectedRevision`. Mutating skills keep an operation-ID stack and call `vault` `undo` in reverse on failure after writes.
4. After multi-page edits, skills typically call `vault` `sync_index` (rebuild `index.md`) and `vault` `log` (append `log.md` / optional `hot.md`), then verify with `sync_index` `dryRun: true` expecting `wouldWrite: false`.

Shared schema and the full MCP contract live in the `llm-wiki` skill.

### Install skills

```bash
npm run skills:install
# or from the published package:
npx cursidian-skills
```

That **removes then copies** the nine skill folders into `~/.cursor/skills/` (never symlink; copying into an existing folder nests `skill/skill/SKILL.md`). Full steps: [`skills/wiki/INSTALL.md`](skills/wiki/INSTALL.md). Re-run after skill or MCP tool-surface changes, then start a **new** agent chat so Cursor re-discovers them.

Exception: none for vault writes. **wiki-slop** uses MCP `vault` `slop_check` / `deslop` for the vault; npm `slop:*` remains for the **repo** build gate (and optional human/CI `*:wiki` CLIs).

| Skill | Purpose | Typical MCP use |
|-------|---------|-----------------|
| `llm-wiki` | Theory, schema, MCP contract | Reference for other skills |
| `wiki-query` | Read-only Q&A | `search` -> optional `note` read / `graph` (no writes) |
| `wiki-lint` | Vault health / consolidate | `vault` `health`, then `note`/`vault` fixes |
| `wiki-setup` | Bootstrap vault structure | `vault` folders, `note` create special files |
| `wiki-ingest` | Distill docs/URLs into pages | `search` + `note` create/update + `vault` manifest/log/sync |
| `wiki-capture` | Save session findings | `note` create/update (`_raw/` or full pages); merge on duplicate |
| `wiki-update` | Sync a project into the wiki | git delta outside vault; writes via `note`/`vault` manifest |
| `wiki-status` | Delta / what next / hot.md | `vault` manifest read; `_raw/` with `includeOperational`; hot refresh on request |
| `wiki-slop` | Deslop repo or vault | Repo: npm `slop:*`. Vault: `vault` `slop_check` / `deslop` |

## Deslop (LLM-slop)

Keeps AI typography (em/en dashes, curly quotes, ellipsis, arrows) and decorative emoji out of the package and, when you ask, the Obsidian vault. Uses [`llm-slop-detector`](https://www.npmjs.com/package/llm-slop-detector) with this repo's [`.llmsloprc.json`](.llmsloprc.json). Vault MCP deslop covers **bodies and frontmatter** (including `summary`) so index drift stays clear.

| Command / tool | Purpose |
|----------------|---------|
| `npm run slop:check` | Scan this repo; exit non-zero if dirty |
| `npm run slop:fix` | Auto-fix chars/emoji in this repo |
| `vault` `slop_check` | Read-only vault slop report (body + frontmatter) |
| `vault` `deslop` | Journaled vault char/emoji fix (`dryRun` / `confirm: true`) |
| `npm run slop:check:wiki` | Human/CI CLI vault scan (agents prefer MCP) |
| `npm run slop:fix:wiki` | Human/CI CLI vault fix (agents must use MCP `deslop`) |
| `npm run build` | `prebuild` -> `slop:check`, then `tsc` |

Wiki scans use the same rules but do **not** gate `build` (the vault lives outside the package). Phrase-pack hits need a manual rewrite; chars/emoji are auto-fixed. Prefer the `wiki-slop` skill over ad-hoc CLI flags.

## Safe write workflow

1. **Read** - `note` with `action: "read"`; note the `revisionHash` (full note) and legacy `contentHash` (body only).
2. **Edit** - `note` with `action: "update"` using the safest mode for surgical edits (`patch`, `replace_section`, `append`, `prepend`). For wholesale page rewrites, use a single `replace`. Prefer one combined `update` that also passes `frontmatter` (merge) so body + metadata share one `operationId`.
3. Pass `expectedRevision` from step 1 to detect concurrent edits (including frontmatter-only changes). `expectedHash` still works as a deprecated body-hash alias.
4. On success, record `operationId` when present and replace any cached `revisionHash` for that path with the response value. To reverse: `vault` `undo` with `operationId` and `confirm: true`.

### Same-path edits in one session

- Never fire parallel `note` mutations for the same path.
- Pattern: `read` -> immediate write with that `revisionHash` -> use the **response** `revisionHash` for any further write to that path.
- Prefer combined body + `frontmatter` on one `update` over a body write then a separate `frontmatter` call.
- On `hash_mismatch`, prefer `details.currentRevision` for frontmatter-only / full-`replace` retries; re-read when re-deriving a `patch` / `replace_section`.

### Undo example

```json
{ "action": "history", "limit": 10 }
```

```json
{ "action": "undo", "operationId": "<id-from-mutation>", "confirm": true }
```

### Manifest example

```json
{
  "action": "manifest",
  "manifestOperation": "upsert_source",
  "sourceKey": "C:/abs/path/paper.pdf",
  "sourceIngested": "2026-07-13T00:00:00Z",
  "sourcePages": ["concepts/foo"]
}
```

## Security model

Cursidian is a **local stdio MCP server**. It trusts the Cursor process that launches it and the OS user that owns the vault directory. There is no network attack surface in normal use; hardening focuses on **path containment**, **bounded I/O**, and **recoverable writes** when agents or external editors touch the vault.

| Layer | What it guarantees |
|-------|-------------------|
| **Lexical containment** | Resolved paths must stay under `OBSIDIAN_VAULT_PATH` (blocks `../` and absolute escapes). |
| **Real-path containment** | Symlinks/junctions that resolve outside the vault are rejected before reads and writes. |
| **Symlink-safe discovery** | Vault scans use `followSymbolicLinks: false` and filter results whose real path escapes the vault. |
| **Atomic single-file writes** | Creates use exclusive open; updates use same-directory temp + rename under a per-path lock. |
| **Optimistic concurrency** | `revisionHash` / `expectedRevision` checked under the mutation lock; frontmatter-only external edits are detected. |
| **Multi-file rollback** | Rename (including source backup), backlink rewrites, and `vault log` (log + hot) journal together and roll back on failure; `partial_update` with `sideEffects: "partial"` only when rollback itself fails. |

For untrusted agents or shared machines, run with `OBSIDIAN_READ_ONLY=true` and restrict vault directory ACLs to least privilege.

### Backups (`.cursidian-trash`)

When `OBSIDIAN_BACKUP_ENABLED` is true (default), each mutating MCP call journals under `.cursidian-trash/<operationId>/` (prior snapshots for every affected path, including creates so undo can remove them):

| Operation | Journaled |
|-----------|-----------|
| `note` update / replace / patch / section edit | Yes |
| `note` frontmatter set / merge / delete | Yes |
| `note` delete | Yes |
| `note` rename | Yes (source + each rewritten backlink/index file) |
| `note` create (incl. overwrite) | Yes |
| `vault` sync_index | Yes (`index.md`) |
| `vault` log | Yes (`log.md`; `hot.md` when updated) |
| `vault` manifest | Yes |

Legacy `.obsidian-mcp-trash` entries are **migrated** into `.cursidian-trash/_legacy-migrated/` on first backup (not deleted). Retention keeps the newest **50** operation folders by default; older folders are pruned automatically. With backups disabled, mutations still succeed but return `undoAvailable: false`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OBSIDIAN_VAULT_PATH` | Yes | Absolute path to your Obsidian vault (`~` / `%USERPROFILE%` expanded) |
| `OBSIDIAN_READ_ONLY` | No | Set to `true` to disable writes |
| `OBSIDIAN_MAX_FILE_SIZE` | No | Max file size in bytes (default 10 MB) |
| `OBSIDIAN_BACKUP_ENABLED` | No | Pre-write backups to `.cursidian-trash` (default `true`; set `false` to disable) |
| `OBSIDIAN_LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default `info`) |

## Development

```bash
npm run dev      # run server directly (stdio)
npm test         # vitest with coverage
npm run test:file -- tests/tools/read-note.test.ts  # focused test file, no coverage threshold
npm run test:clean # coverage run through npm env cleanup for Cursor sandboxes
npm run lint     # eslint
npm run typecheck
npm run build    # slop:check (prebuild), then tsc
npm run verify   # lint + typecheck + test + build + MCP integration + skills check + fixture smoke
npm run smoke    # live smoke against OBSIDIAN_VAULT_PATH (unique path, finally cleanup)
npm run skills:check
npm run mcp:test -- suite smoke
```


In Cursor agent sandboxes, npm may inherit a deprecated `npm_config_devdir` value. Use
`npm run verify` or `npm run test:clean` so child processes run through the repository's
npm environment cleanup. On Windows PowerShell, prefer these scripts over manual `&&`
command chains.

Isolated tool calls:

```bash
npm run mcp:test -- note --action read --path index
npm run mcp:test -- search --query "wiki index" --limit 10
npm run mcp:test -- --list
```

## License

MIT - see [LICENSE](LICENSE).
