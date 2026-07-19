---
description: Hand off a REVIEW to Grok (--permission-mode plan). Returns findings and rejects observed mutation.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill to hand off a **review** to **Grok**.

- provider: `grok`
- verb: `review`
- request: $ARGUMENTS

Scope it into a brief written to a file, then run
`node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" --provider grok --verb review --prompt-file <file> --cwd "$(pwd)" --structured`
and present the findings the driver returns. The compatible adapter selects permission plan mode but
does not select the v0.2 machine adapter's named `read-only` sandbox. The brief forbids changes, and the
driver rejects the review if Git evidence observes a mutation.
