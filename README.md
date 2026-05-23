# CleanVibe

Cursor plugin-only auditor for AI-speed TypeScript and JavaScript coding.

CleanVibe provides five manual Cursor commands:

- `/cleanvibe` - whole-project technical debt audit
- `/cleanvibe-diff` - current git diff plus untracked source files
- `/cleanvibe-index` - refresh and summarize the local architecture index
- `/cleanvibe-react` - React-specific detector pack
- `/cleanvibe-next` - Next.js-specific detector pack

## What It Checks

- Duplicate or reimplemented shared utilities
- Feature-to-feature import boundary drift
- Complexity growth in newly changed code
- Production behavior added without test changes
- Suspicious shortcuts such as `TODO`, `FIXME`, `quick fix`, `as any`, and `console.log`
- Simple performance-risk hints such as broad queries or sequential async patterns

## Cursor Plugin Contents

- `.cursor-plugin/plugin.json` - Cursor plugin manifest
- `commands/cleanvibe.md` - whole-project audit command
- `commands/cleanvibe-diff.md` - diff audit command
- `commands/cleanvibe-index.md` - index summary command
- `commands/cleanvibe-react.md` - React detector pack command
- `commands/cleanvibe-next.md` - Next.js detector pack command
- `skills/cleanvibe/SKILL.md` - CleanVibe command routing and reporting rules
- `mcp.json` - local MCP server registration
- `src/mcp/server.mjs` - dependency-free stdio MCP server
- `src/analyzer/index.mjs` - project index, diff reader, and debt-risk detectors

## Usage

Install from Cursor Marketplace:

```text
Coming soon.
```

Until the Marketplace listing is approved, load it locally from the repository/plugin source, then run:

```text
/cleanvibe
```

For a fast diff-only pass:

```text
/cleanvibe-diff
```

The commands tell Cursor Agent to call the CleanVibe MCP tools and return Markdown, not raw JSON.

React and Next.js packs can be run directly:

```text
/cleanvibe-react
/cleanvibe-next
```

The plugin does not edit files.

## Privacy Model

The analyzer is local. It returns a structured report using the current diff plus minimal snippets/evidence from static analysis. The skill instructs Cursor Agent not to request or include full project context by default.

The local cache is written outside the project by default:

- `CLEANVIBE_CACHE_DIR` if set
- `VIBE_AUDIT_CACHE_DIR` if set, for backward compatibility
- `XDG_CACHE_HOME` if set
- otherwise the OS temp directory

## Limitations

- CleanVibe uses heuristic static analysis, not a full TypeScript type checker or AST-based linter.
- The detector surface is focused on TypeScript and JavaScript projects.
- Diff audits require git, and uncommitted generated files can affect the report.
- Reports intentionally cap findings to the highest-signal items instead of listing every possible issue.
- Cursor Agent must invoke the CleanVibe MCP tools for the commands to return live audit results.

## Development

No npm dependencies are required.

```bash
npm test
```

Run the MCP server manually:

```bash
npm run cleanvibe:mcp
```

## MCP Troubleshooting

If Cursor says **"MCP server isn't connected"**:

1. Open **Cursor Settings → MCP** and check the `cleanvibe` server status. Open the error details if it is red.
2. Ensure the **CleanVibe** plugin is enabled under **Settings → Plugins**.
3. Fully **restart Cursor** (not only Reload Window) after changing the plugin or `mcp.json`.
4. On macOS, GUI Cursor often cannot find `node` from nvm/Herd. `mcp.json` sets `type: "stdio"` and includes Homebrew plus `/usr/local/bin` in `PATH`. If MCP stays on **Loading tools**, add your Node install directory to the `PATH` env entry in `mcp.json`.
5. For development in this repository, `.cursor/mcp.json` registers the same server via `${workspaceFolder}/src/mcp/server.mjs`.
6. Disable duplicate CleanVibe MCP entries if both the plugin MCP and project `.cursor/mcp.json` are enabled at once.

## Local Cursor Install

For local testing on macOS:

```bash
mkdir -p ~/.cursor/plugins/local
ln -sfn /Users/gh0sty/Documents/dev/cleanVibe \
  ~/.cursor/plugins/local/cleanvibe
```

Then run `Developer: Reload Window` in Cursor. If Cursor still does not show the MCP server, restart Cursor completely or copy the folder instead of symlinking:

```bash
rm -rf ~/.cursor/plugins/local/cleanvibe
cp -R /Users/gh0sty/Documents/dev/cleanVibe \
  ~/.cursor/plugins/local/cleanvibe
```

## Public Release

Before submitting to Cursor Marketplace:

```bash
npm test
node --check src/analyzer/index.mjs
node --check src/mcp/server.mjs
```

Then publish the GitHub repository publicly and submit the repository URL at:

```text
https://cursor.com/marketplace/publish
```

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the full checklist.
