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

This deletes each of the 11 skill folders under `~/.cursor/skills/`, copies fresh from `skills/wiki/`, and verifies there are no nested duplicates, no legacy tool names (`read_note`, `search_content`, ...), that `vault`/`wiki-context` still teach the `context` MCP tool, and that `slop/scripts/deslop.mjs` is present.

Installed skills: `vault`, `wiki-query`, `wiki-context`, `wiki-lint`, `wiki-setup`, `wiki-ingest`, `wiki-capture`, `wiki-update`, `wiki-status`, `wiki-slop`, `slop`.

**Local-only addenda** (live under `~/.cursor/skills/` but are **not** in this install list, so `skills:install` does not overwrite them): `wiki-first`, `wiki-structure`, plus other machine skills (`crosslink`, `tags`, `mcp-test`, deprecated `wiki-migrate`). Those pair with my-agents rules (`wiki-first.mdc`, `wiki-structure.mdc`, ...), not the package.

### After any surface change

Whenever `skills/wiki/` or the MCP tool surface changes, run `npm run skills:install` and then start a **new** Cursor agent chat - Cursor caches skill discovery per chat, so an existing chat keeps teaching the previous skill text (including denylisted tool names) until it is restarted. If you are not sure whether `~/.cursor/skills/` is stale, run:

```bash
npm run skills:doctor
```

It fingerprints each skill folder under `skills/wiki/` against its installed copy and tells you exactly which ones are stale or missing, and what to run next.

### Manual (Windows PowerShell)

```powershell
$src = "C:\path\to\Cursidian\skills\wiki"
$dst = "$env:USERPROFILE\.cursor\skills"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($name in @(
  'vault','wiki-query','wiki-context','wiki-lint','wiki-setup',
  'wiki-ingest','wiki-capture','wiki-update','wiki-status','wiki-slop','slop'
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
for name in vault wiki-query wiki-context wiki-lint wiki-setup wiki-ingest wiki-capture wiki-update wiki-status wiki-slop slop; do
  rm -rf "$DST/$name"
  cp -R "$SRC/$name" "$DST/$name"
done
```

After MCP tool-surface changes, re-run `npm run skills:install` so Cursor does not keep teaching denylisted tool names or an outdated tool count.

## 4. Verify

1. In Cursor, confirm `user-cursidian` tools are listed (`note`, `search`, `graph`, `vault`, `context`) - not a leftover `obsidian` / `user-obsidian` server.
2. Ask the agent to call `search` with `action: "list"`. Every `CallMcpTool` must set `server: "user-cursidian"` and `toolName` (`note` | `search` | `graph` | `vault` | `context`); never `arguments` + `description` alone.
3. For a fresh vault, run the `wiki-setup` skill; otherwise run `wiki-status`.
4. If Cursor still walks denylisted tool allowlist entries (`read_note`, `search_content`, ...), clean them up per [`docs/MCP-HOST-HYGIENE.md`](../../docs/MCP-HOST-HYGIENE.md).
