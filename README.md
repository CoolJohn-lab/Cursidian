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
- **Optimistic concurrency** - `contentHash` on read, optional `expectedHash` on write
- **Signature-based caches** - index and search snapshots invalidate when files change on disk (including Obsidian edits)
- **Deslop gate** - `npm run build` runs `slop:check` first; strips AI typography and decorative emoji from the repo (and optionally the wiki vault)
- **Wiki skills** - nine Cursor skills that drive the MCP tools for ingest, query, lint, capture, update, status, and deslop

## Tools

| Tool | Actions | Purpose |
|------|---------|---------|
| `note` | `read`, `create`, `update`, `delete`, `rename`, `frontmatter` | Note CRUD, safe edits, metadata |
| `search` | `content` (default), `by_tags`, `list`, `recent`, `tags` | Find and enumerate notes |
| `graph` | - | One-hop link neighborhood (outgoing + backlinks) |
| `vault` | `health`, `sync_index`, `create_folder`, `list_folders`, `delete_folder`, `log` | Health audit, catalog, folders, wiki bookkeeping |

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
3. Writes follow the safe-write protocol: `note` `read` -> `contentHash` -> narrowest `note` `update` with `expectedHash`.
4. After multi-page edits, skills typically call `vault` `sync_index` (rebuild `index.md`) and `vault` `log` (append `log.md` / optional `hot.md`).

Shared schema and the full MCP contract live in the `llm-wiki` skill.

### Install skills

```bash
npm run skills:install
```

That **removes then copies** the nine skill folders into `~/.cursor/skills/` (never symlink; copying into an existing folder nests `skill/skill/SKILL.md`). Full steps: [`skills/wiki/INSTALL.md`](skills/wiki/INSTALL.md). Re-run after skill or MCP tool-surface changes, then start a **new** agent chat so Cursor re-discovers them.

Exception: **wiki-slop** runs the npm deslop scripts against the same vault path as MCP (deterministic lint/fix on disk); it does not invent a second vault location.

| Skill | Purpose | Typical MCP use |
|-------|---------|-----------------|
| `llm-wiki` | Theory, schema, MCP contract | Reference for other skills |
| `wiki-query` | Read-only Q&A | `search` -> optional `note` read / `graph` (no writes) |
| `wiki-lint` | Vault health / consolidate | `vault` `health`, then `note`/`vault` fixes |
| `wiki-setup` | Bootstrap vault structure | `vault` folders, `note` create special files |
| `wiki-ingest` | Distill docs/URLs into pages | `search` + `note` create/update + `vault` log/sync |
| `wiki-capture` | Save session findings | `note` create/update (`_raw/` or full pages) |
| `wiki-update` | Sync a project into the wiki | git delta outside vault; writes via `note`/`vault` |
| `wiki-status` | Delta / what next / hot.md | `note` read manifest; optional `hot` refresh |
| `wiki-slop` | Deslop repo or vault | npm `slop:*` scripts (same vault path as MCP) |

## Deslop (LLM-slop)

Keeps AI typography (em/en dashes, curly quotes, ellipsis, arrows) and decorative emoji out of the package and, when you ask, the Obsidian vault. Uses [`llm-slop-detector`](https://www.npmjs.com/package/llm-slop-detector) with this repo's [`.llmsloprc.json`](.llmsloprc.json).

| Command | Purpose |
|---------|---------|
| `npm run slop:check` | Scan this repo; exit non-zero if dirty |
| `npm run slop:fix` | Auto-fix chars/emoji in this repo |
| `npm run slop:check:wiki` | Scan the vault (`OBSIDIAN_VAULT_PATH` or `mcp.json`) |
| `npm run slop:fix:wiki` | Auto-fix chars/emoji in the vault |
| `npm run build` | `prebuild` -> `slop:check`, then `tsc` |

Wiki scans use the same rules but do **not** gate `build` (the vault lives outside the package). Phrase-pack hits need a manual rewrite; chars/emoji are auto-fixed. Prefer the `wiki-slop` skill over ad-hoc CLI flags.

## Safe write workflow

1. **Read** - `note` with `action: "read"`; note the `contentHash`.
2. **Edit** - `note` with `action: "update"` using the safest mode (`patch`, `replace_section`, `append`, `prepend`, or `replace`).
3. Pass `expectedHash` from step 1 to detect concurrent edits.

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
npm run verify   # lint + typecheck + test + build
npm run smoke    # live smoke against OBSIDIAN_VAULT_PATH
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
