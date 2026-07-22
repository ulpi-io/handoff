---
description: Strictly hand off a permission-scoped build to Kiro through the machine ABI.
argument-hint: "<what to build>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
disable-model-invocation: true
---
Use the **handoff-run** skill with provider `kiro`, role `build`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness kiro --mode build` flow. Kiro receives `fs_read`, `fs_write`, plus the resolved Bash grant. Report `output.response` and
result and complete Git evidence.
