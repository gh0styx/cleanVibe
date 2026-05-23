# CleanVibe React

Run the CleanVibe React detector pack.

Use the `cleanvibe` skill and the `run_cleanvibe_react_audit` MCP tool:

1. Call `run_cleanvibe_react_audit` for the current workspace.
2. Return the Markdown report exactly as the tool returns it.

This pack audits React-specific debt:

- component complexity
- hook drift
- direct data fetching in components
- render performance risks
- accessibility debt

Do not print raw JSON unless the user explicitly asks for machine-readable output. Do not modify files.
