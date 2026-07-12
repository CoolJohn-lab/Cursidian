# Cursidian

MCP server for local [Obsidian](https://obsidian.md) vaults, optimised for **Cursor agents** — safe note editing, lean tool surface, direct filesystem access. No Local REST API plugin required; Obsidian does not need to be open.

npm package: [`cursidian`](https://www.npmjs.com/package/cursidian).

## Features

- **4 MCP tools** — `note`, `search`, `graph`, `vault` (action-dispatch surface)
- **Safe writes** — `patch` inferred when `old_string`/`new_string` are set; `replace_section` for heading edits
- **Agent-friendly search** — default limit 10, compact format, stopwords stripped, token-AND with OR/typo fallback; hits include `title`/`summary`/`tags`
- **Auto timestamps** — `note` create/update/frontmatter set `created`/`updated` automatically
- **Optimistic concurrency** — `contentHash` on read, optional `expectedHash` on write
- **Signature-based caches** — index and search snapshots invalidate when files change on disk (including Obsidian edits)

## Tools (v1)

| Tool | Actions | Purpose |
|------|---------|---------|
| `note` | `read`, `create`, `update`, `delete`, `rename`, `frontmatter` | Note CRUD, safe edits, metadata |
| `search` | `content` (default), `by_tags`, `list`, `recent`, `tags` | Find and enumerate notes |
| `graph` | — | One-hop link neighborhood (outgoing + backlinks) |
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

## Wiki skills

Tracked skills live in [`skills/wiki/`](skills/wiki/). Copy them into `~/.cursor/skills/` (do not symlink). Full steps: [`skills/wiki/INSTALL.md`](skills/wiki/INSTALL.md).

The skills are **MCP-only**: agents touch the vault exclusively through the `user-cursidian` tools. There is no filesystem fallback — if the MCP server fails, the agent reports the failure and stops rather than editing vault files directly.

| Skill | Purpose |
|-------|---------|
| `llm-wiki` | Theory, schema, the MCP contract |
| `wiki-query` | Read-only Q&A |
| `wiki-lint` | Vault health |
| `wiki-setup` | Bootstrap a wiki vault |
| `wiki-ingest` | Distill sources into wiki pages |
| `wiki-capture` | Capture a session into the wiki |
| `wiki-update` | Sync a project into the wiki |
| `wiki-status` | Status / delta / hot.md |

## Safe write workflow

1. **Read** — `note` with `action: "read"`; note the `contentHash`.
2. **Edit** — `note` with `action: "update"` using the safest mode (`patch`, `replace_section`, `append`, `prepend`, or `replace`).
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
npm run build
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

## Credits
I took the "Obsidian Wiki" concept from Andrej Karpathy, and I drew inspiration from this existing Obsidian MCP: [@istrejo/obsidian-mcp](https://github.com/istrejo/obsidian-mcp). But really the credit goes to Fable, Grok and Composer 2.5, I am just their conductor, and I used Cursor to create this.

## License

MIT — see [LICENSE](LICENSE).
