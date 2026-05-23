# Publishing CleanVibe

This checklist prepares CleanVibe for public GitHub release and Cursor Marketplace submission.

## 1. Repository Readiness

- Repository is public.
- Repository name is `cleanvibe`.
- Default branch contains:
  - `.cursor-plugin/plugin.json`
  - `commands/`
  - `skills/`
  - `mcp.json`
  - `README.md`
  - `CHANGELOG.md`
  - `LICENSE`
  - `SECURITY.md`
- `README.md` explains install, commands, privacy model, and limitations.

## 2. Manifest Check

Verify `.cursor-plugin/plugin.json`:

- `name`: `cleanvibe`
- `displayName`: `CleanVibe`
- `version`: matches `package.json`
- `description`: clear and short
- `author`: real owner or company
- `repository`: public GitHub URL
- `homepage`: public GitHub URL or product page
- `license`: `MIT`
- `skills`: `./skills/`
- `commands`: `./commands/`
- `mcp`: `./mcp.json`

## 3. Verification

Run:

```bash
npm test
node --check src/analyzer/index.mjs
node --check src/mcp/server.mjs
```

Smoke-test MCP tools:

```bash
npm run cleanvibe:mcp
```

Then test in Cursor through local plugin install:

```bash
mkdir -p ~/.cursor/plugins/local
ln -sfn /absolute/path/to/cleanvibe ~/.cursor/plugins/local/cleanvibe
```

Reload Cursor and run:

```text
/cleanvibe
/cleanvibe-diff
/cleanvibe-index
```

## 4. Marketplace Submission

Submit the public repository URL at:

```text
https://cursor.com/marketplace/publish
```

Use the GitHub repository URL as the source. Keep the repository public during review.

## 5. Release Notes

For every Marketplace update:

- update `.cursor-plugin/plugin.json` version
- update `package.json` version
- update `CHANGELOG.md`
- rerun verification
- push a git tag such as `v0.1.0`
