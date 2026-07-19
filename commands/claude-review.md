---
description: Hand off a REVIEW to Claude Code (headless `claude -p`, manual permission mode). Returns findings and rejects observed mutation.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill to hand off a **review** to **Claude** (headless `claude -p`).

- provider: `claude`
- verb: `review`
- request: $ARGUMENTS

Scope it into a brief written to a file, then run
`node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" --provider claude --verb review --prompt-file <file> --cwd "$(pwd)" --structured`
and present the findings the driver returns. It runs `--permission-mode manual`; this compatible
adapter does not isolate Claude configuration or enable/preflight Claude's native Bash sandbox. The
brief forbids changes, and the driver rejects the review if Git evidence observes a mutation.
