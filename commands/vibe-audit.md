# Vibe Audit

Run a concise technical debt review for the current workspace diff.

Use the legacy `vibe-audit` skill and the `run_vibe_audit` MCP tool:

1. Call `run_vibe_audit` for the current workspace.
2. Return the Markdown report exactly as the tool returns it.

Report format:

```markdown
## Vibe Audit
Status: OK | Watch | Debt risk

1. [severity] category — file
   What changed:
   Why it matters:
   Suggested next step:
   Reuse target: path#symbol, if present
```

Keep the report to the top seven findings. Do not print raw JSON unless the user explicitly asks for machine-readable output. Do not modify files. Do not request or include full project context; use only the diff, untracked source files, and minimal snippets surfaced by the analyzer.
