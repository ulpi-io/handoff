---
description: Strictly hand off a permission-confined build to OpenCode through the machine ABI.
argument-hint: "<what to build>"
allowed-tools: [Bash, Read, Write, Grep, Glob]
disable-model-invocation: true
---
Use the **handoff-run** skill with provider `opencode`, role `build`, cwd `$(pwd)`, and request
`$ARGUMENTS`. Use the exact root `handoff.mjs run --caller-harness claude --harness opencode --mode build` flow. The resolved named-agent
policy and requested Bash, web, and MCP grants must be preflighted.
