# CleanVibe Diff

Run a CleanVibe audit for the current git diff and untracked source files.

Use the `cleanvibe` skill and the `run_cleanvibe_diff_audit` MCP tool:

1. Call `run_cleanvibe_diff_audit` for the current workspace.
2. Return the Markdown report exactly as the tool returns it.

This command is the fast "what changed right now?" review. It includes untracked TypeScript/JavaScript source files by default.

Do not print raw JSON unless the user explicitly asks for machine-readable output. Do not modify files.
