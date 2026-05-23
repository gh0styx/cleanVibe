# CleanVibe Next

Run the CleanVibe Next.js detector pack.

Use the `cleanvibe` skill and the `run_cleanvibe_next_audit` MCP tool:

1. Call `run_cleanvibe_next_audit` for the current workspace.
2. Return the Markdown report exactly as the tool returns it.

This pack audits Next.js-specific debt:

- client/server boundary drift
- implicit fetch cache or revalidation behavior
- route handlers without visible error/validation boundaries

Do not print raw JSON unless the user explicitly asks for machine-readable output. Do not modify files.
