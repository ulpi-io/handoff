---
description: Strictly hand off a permission-read-only review to OpenCode through the machine ABI.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill with provider `opencode`, role `review`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness opencode --mode review` flow. Present normalized
findings and resolved grants; any observed mutation is blocked.
