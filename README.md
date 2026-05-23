# CleanVibe

Cursor plugin-only auditor for AI-speed TypeScript and JavaScript coding.

CleanVibe provides three manual Cursor commands:

- `/cleanvibe` - whole-project technical debt audit
- `/cleanvibe-diff` - current git diff plus untracked source files
- `/cleanvibe-index` - refresh and summarize the local architecture index
- `/cleanvibe-react` - React-specific detector pack
- `/cleanvibe-next` - Next.js-specific detector pack

The legacy `/vibe-audit` command remains as a diff-audit alias.

## What It Checks

- Duplicate or reimplemented shared utilities
- Feature-to-feature import boundary drift
- Complexity growth in newly changed code
- Production behavior added without test changes
- Suspicious shortcuts such as `TODO`, `FIXME`, `quick fix`, `as any`, and `console.log`
- Simple performance-risk hints such as broad queries or sequential async patterns

## Cursor Plugin Contents

- `.cursor-plugin/plugin.json` - Cursor plugin manifest
- `commands/vibe-audit.md` - Cursor command instructions
- `commands/cleanvibe.md` - whole-project audit command
- `commands/cleanvibe-diff.md` - diff audit command
- `commands/cleanvibe-index.md` - index summary command
- `commands/cleanvibe-react.md` - React detector pack command
- `commands/cleanvibe-next.md` - Next.js detector pack command
- `skills/cleanvibe/SKILL.md` - CleanVibe command routing and reporting rules
- `skills/vibe-audit/SKILL.md` - report-writing workflow for Cursor Agent
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

## Development

No npm dependencies are required.

```bash
npm test
```

Run the MCP server manually:

```bash
npm run cleanvibe:mcp
```

## Local Cursor Install

For local testing on macOS:

```bash
mkdir -p ~/.cursor/plugins/local
ln -sfn /Users/gh0sty/Documents/dev/vibecoding-cursor-sdk \
  ~/.cursor/plugins/local/cleanvibe
```

Then run `Developer: Reload Window` in Cursor. If Cursor still does not show the MCP server, restart Cursor completely or copy the folder instead of symlinking:

```bash
rm -rf ~/.cursor/plugins/local/cleanvibe
cp -R /Users/gh0sty/Documents/dev/vibecoding-cursor-sdk \
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
