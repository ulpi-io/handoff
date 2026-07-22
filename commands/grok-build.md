---
description: Strictly hand off a sandboxed build to Grok through the machine ABI.
argument-hint: "<what to build>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
disable-model-invocation: true
---
Use the **handoff-run** skill with provider `grok`, role `build`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness grok --mode build` flow. Report `output.response` and
result and complete Git evidence.
