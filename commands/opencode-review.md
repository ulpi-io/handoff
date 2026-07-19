---
description: Hand off a REVIEW to opencode (headless `opencode run`, Plan agent). Returns findings and rejects observed mutation.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill to hand off a **review** to **opencode** (headless `opencode run`).

- provider: `opencode`
- verb: `review`
- request: $ARGUMENTS

Scope it into a brief written to a file, then run
`node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" --provider opencode --verb review --prompt-file <file> --cwd "$(pwd)" --structured`
and present the findings the driver returns. It selects OpenCode's restricted `--agent plan`, but this
compatible adapter does not isolate OpenCode's merged configuration or claim an OS sandbox. The driver
rejects observed mutation. OpenCode JSON mode is raw events, so the legacy structured-review path asks
for a JSON findings block in the brief.
