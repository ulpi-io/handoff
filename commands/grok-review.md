---
description: Strictly hand off a read-only sandboxed review to Grok through the machine ABI.
argument-hint: "<what to review>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
---
Use the **handoff-run** skill with provider `grok`, role `review`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness grok --mode review` flow. Present normalized
findings; any observed mutation is blocked.
