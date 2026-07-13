# Installing Cursidian wiki skills

## 1. Install Node.js 20+

Confirm with `node -v`.

## 2. Configure the Cursidian MCP server

Add this block to `~/.cursor/mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`):

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

Unix example vault path: `/Users/you/Documents/MyVault`.

The path **must be absolute**. Relative paths are rejected.

For local development against a clone, use:

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

Reload Cursor after saving.

Config key `"cursidian"` appears as MCP server **`user-cursidian`** in agent tools.

From a local clone, verify the config is not still pointing at a predecessor path:

```bash
npm run mcp:check
```

The MCP server is the **only** way skills touch the vault - there is no `.env` walk-up or
filesystem fallback. The vault path lives in `mcp.json` and nowhere else.

## 3. Install skills into Cursor (copy only - do not symlink)

Skills must live as `~/.cursor/skills/<name>/SKILL.md`. **Always remove the target folder before copying** - copying into an existing folder nests as `<name>/<name>/SKILL.md`, and Cursor will load the stale nested copy.

### Recommended (from this repo)

```bash
npm run skills:install
# preview only:
npm run skills:install:dry
```

This deletes each of the 9 skill folders under `~/.cursor/skills/`, copies fresh from `skills/wiki/`, and verifies there are no nested duplicates or legacy tool names (`read_note`, `search_content`, ...).

Installed skills: `llm-wiki`, `wiki-query`, `wiki-lint`, `wiki-setup`, `wiki-ingest`, `wiki-capture`, `wiki-update`, `wiki-status`, `wiki-slop`.

### Manual (Windows PowerShell)

```powershell
$src = "C:\path\to\Cursidian\skills\wiki"
$dst = "$env:USERPROFILE\.cursor\skills"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($name in @(
  'llm-wiki','wiki-query','wiki-lint','wiki-setup',
  'wiki-ingest','wiki-capture','wiki-update','wiki-status','wiki-slop'
)) {
  Remove-Item -Recurse -Force "$dst\$name" -ErrorAction SilentlyContinue
  Copy-Item -Recurse -Force "$src\$name" "$dst\$name"
}
```

### Manual (macOS / Linux)

```bash
SRC=/path/to/Cursidian/skills/wiki
DST="$HOME/.cursor/skills"
mkdir -p "$DST"
for name in llm-wiki wiki-query wiki-lint wiki-setup wiki-ingest wiki-capture wiki-update wiki-status wiki-slop; do
  rm -rf "$DST/$name"
  cp -R "$SRC/$name" "$DST/$name"
done
```

After MCP tool-surface changes (e.g. the 4-tool consolidation), re-run `npm run skills:install` so Cursor does not keep teaching retired tool names.

## 4. Verify

1. In Cursor, confirm `user-cursidian` tools are listed (`note`, `search`, `graph`, `vault`) - not a leftover `obsidian` / `user-obsidian` server.
2. Ask the agent to call `search` with `action: "list"`. Every `CallMcpTool` must set `server: "user-cursidian"` and `toolName` (`note` | `search` | `graph` | `vault`); never `arguments` + `description` alone.
3. For a fresh vault, run the `wiki-setup` skill; otherwise run `wiki-status`.
4. If Cursor still walks retired tool allowlist entries (`read_note`, `search_content`, ...), clean them up per [`docs/MCP-HOST-HYGIENE.md`](../../docs/MCP-HOST-HYGIENE.md).
