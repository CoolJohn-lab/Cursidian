# MCP host hygiene (Cursor)

After cutting over from older Obsidian MCP servers (`obsidian` / `user-obsidian`, `Obsidian-MCP-For-Cursor`), Cursor may still carry stale permission allowlist entries and known-server ids. Those do not deny `user-cursidian` calls, but they add log noise (`serverPattern="obsidian"`, `toolPattern="read_note|search_content|…"`) on every tool invocation.

## Do

1. **Settings -> MCP** - ensure only the `cursidian` server is configured in `~/.cursor/mcp.json`. Remove any leftover `obsidian` server block.
2. Run `npm run mcp:check` from this repo (read-only; fails on predecessor paths or missing absolute `OBSIDIAN_VAULT_PATH`).
3. **Clear auto-run / tool approvals** for retired tools if your Cursor build exposes them (`read_note`, `search_content`, `list_notes`, `create_note`, `update_note`, `manage_folders`, `manage_frontmatter`, ...). Prefer approving the current four tools: `note`, `search`, `graph`, `vault`.
4. **Restart Cursor** (or restart the `user-cursidian` MCP server) after `mcp.json` or `dist/` changes.
5. Confirm the agent tool list shows **`user-cursidian`** with exactly those four tools.

## Do not

- Hand-edit Cursor `state.vscdb` (or other SQLite state) while Cursor is open - risk of corruption.
- Keep teaching retired tool names in project rules or skills; re-run `npm run skills:install` after skill updates.

## Optional verbose MCP logs

Operational `INFO` lines no longer write to stderr by default (Cursor was labeling them `[error]`). To capture them:

- Set `OBSIDIAN_LOG_FILE` to an absolute path in the `cursidian` `env` block, or
- Set `OBSIDIAN_LOG_STDERR_INFO=true` for local debugging only.

`WARN` / `ERROR` / `[FATAL]` still go to stderr. Do not log to stdout - that stream is reserved for MCP JSON-RPC.
