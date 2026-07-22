---
description: Strictly hand off a permission-read-only review to Kiro through the machine ABI.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill with provider `kiro`, role `review`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness kiro --mode review` flow. Kiro receives `fs_read`
plus the resolved Bash grant; present normalized findings and block any observed mutation.
