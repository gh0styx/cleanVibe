# Security Policy

## Supported Versions

CleanVibe is pre-1.0. Security fixes target the latest released version.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory at:

https://github.com/gh0styx/cleanVibe/security/advisories/new

Do not publish exploit details in public issues before a fix is available.

## Privacy Model

CleanVibe's analyzer runs locally. It reads project files to build a lightweight architecture index and stores its cache outside the project directory.

The Cursor command output is designed to use:

- current diff and untracked source files for diff audits
- local project index and minimal evidence snippets for project audits

CleanVibe does not intentionally modify source files.
