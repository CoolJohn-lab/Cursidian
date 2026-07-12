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

The MCP server is the **only** way skills touch the vault — there is no `.env` walk-up or
filesystem fallback. The vault path lives in `mcp.json` and nowhere else.

## 3. Copy skills into Cursor (copy only — do not symlink)

From this repo, copy each skill folder into the user-global Cursor skills directory.

**Windows (PowerShell):**

```powershell
$src = "C:\path\to\Cursidian\skills\wiki"
$dst = "$env:USERPROFILE\.cursor\skills"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($name in @(
  'llm-wiki','wiki-query','wiki-lint','wiki-setup',
  'wiki-ingest','wiki-capture','wiki-update','wiki-status'
)) {
  Copy-Item -Recurse -Force "$src\$name" "$dst\$name"
}
```

**macOS / Linux:**

```bash
SRC=/path/to/Cursidian/skills/wiki
DST="$HOME/.cursor/skills"
mkdir -p "$DST"
for name in llm-wiki wiki-query wiki-lint wiki-setup wiki-ingest wiki-capture wiki-update wiki-status; do
  cp -R "$SRC/$name" "$DST/$name"
done
```

## 4. Verify

1. In Cursor, confirm `user-cursidian` tools are listed (`note`, `search`, `graph`, `vault`).
2. Ask the agent to call `search` with `action: "list"`.
3. For a fresh vault, run the `wiki-setup` skill; otherwise run `wiki-status`.
