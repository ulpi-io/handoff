---
description: Strictly hand off a sandboxed build to Cursor through the machine ABI.
argument-hint: "<what to build>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
disable-model-invocation: true
---
Use the **handoff-run** skill with provider `cursor`, role `build`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness cursor --mode build` flow. The driver must preflight
Cursor's native command sandbox and validate its single JSON result envelope.
