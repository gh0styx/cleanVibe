# CleanVibe

Run a whole-project CleanVibe technical debt audit.

Use the `cleanvibe` skill and the `run_cleanvibe_project_audit` MCP tool:

1. Call `run_cleanvibe_project_audit` for the current workspace.
2. Return the Markdown report exactly as the tool returns it.

This command audits the indexed TypeScript/JavaScript project, not just the current git diff. It should report the top project-wide risks: duplicate exports, feature boundary drift, complexity hotspots, and shortcut markers.

Do not print raw JSON unless the user explicitly asks for machine-readable output. Do not modify files.
