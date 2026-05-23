# Contributing

Contributions should keep CleanVibe lightweight, local-first, and useful inside Cursor chat.

## Development

```bash
npm test
node --check src/analyzer/index.mjs
node --check src/mcp/server.mjs
```

## Guidelines

- Keep detector output concise and actionable.
- Prefer local static analysis before adding AI-dependent behavior.
- Do not add automatic code modification without an explicit design decision.
- Add tests for every detector behavior.
- Keep plugin commands returning Markdown by default, not raw JSON.
