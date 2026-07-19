---
description: Hand off a REVIEW to Kiro (--trust-tools fs_read only; permission allowlist, not native filesystem isolation). Returns findings; changes nothing.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill to hand off a **review** to **Kiro**.

- provider: `kiro`
- verb: `review`
- request: $ARGUMENTS

Scope it into a brief written to a file, then run
`node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" --provider kiro --verb review --prompt-file <file> --cwd "$(pwd)"`
and present the findings. Kiro chat has no structured-output flag, so ask (in the brief) for the findings
as a JSON block. It receives only the `fs_read` tool allowlist (never `execute_bash`) and must not
modify anything. This is a Kiro tool-permission guarantee, not a native filesystem sandbox claim.
