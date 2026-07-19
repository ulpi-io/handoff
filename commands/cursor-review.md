---
description: Hand off a REVIEW to Cursor (headless `cursor-agent -p`, no --force). Returns findings and rejects observed mutation.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill to hand off a **review** to **Cursor** (headless `cursor-agent -p`).

- provider: `cursor`
- verb: `review`
- request: $ARGUMENTS

Scope it into a brief written to a file, then run
`node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" --provider cursor --verb review --prompt-file <file> --cwd "$(pwd)"`
and present the findings the driver returns.

Cursor documents print mode without `--force` as proposing file changes rather than applying them, but
the compatible adapter does not isolate loaded Cursor permissions or preflight its command sandbox.
Treat this as configuration-dependent rather than a hard sandbox guarantee. The brief forbids changes,
and the driver rejects the review if Git evidence observes a mutation.
