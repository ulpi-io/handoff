---
name: handoff-run
description: Delegate one bounded build, phase, review, or verification from Codex or Claude to Codex, Grok, Kiro, Claude, OpenCode, or Cursor through Handoff's supervised machine ABI. Use when the user asks another harness to execute or independently verify work, with explicit model, effort, turn, Bash, web, MCP, lineage, and budget controls. Never invoke a provider directly.
---

# Run a handoff

Use only the bundled `scripts/handoff.mjs` entrypoint. There is no global CLI, alias, direct provider
helper, or weaker execution route.

Write a self-contained request to a private `instructions.txt`: one goal, exact scope, testable
acceptance criteria, validation commands, and explicit guardrails. Use `build|phase` only when a
Git-observable change is required; use `review|verify` for read-only work.

## Root command

Only a Codex or Claude root may start a higher-level handoff:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" run \
  --caller-harness <codex|claude> \
  --harness <codex|grok|kiro|claude|opencode|cursor> \
  --mode <build|phase|review|verify> \
  --cwd "$(pwd -P)" \
  --instructions <absolute-private-path>/instructions.txt \
  --result <absolute-private-path>/result.json
```

The caller value is asserted lineage metadata, not host authentication. The selected target still
uses its native logged-in CLI or API-key precedence.

## Nested command

When `HANDOFF_SUPERVISOR_CONTEXT` exists, omit `--caller-harness` and every root budget flag. The
ephemeral supervisor derives the caller from the parent target, authenticates the request, applies
grant attenuation, owns the DAG, and routes the child through the same machine executor.

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" run \
  --harness <target-harness> \
  --mode <build|phase|review|verify> \
  --cwd "$(pwd -P)" \
  --instructions <absolute-private-path>/instructions.txt \
  --result <absolute-private-path>/result.json
```

Nested `run` is accepted only when the derived caller is Codex or Claude. Add repeatable typed
dependencies as `--dependency requires:<run-id>`, `advises:<run-id>`, or `verifies:<run-id>`.

## Optional controls

- `--model <provider-model>`; omission records `provider-default`.
- `--effort <provider-supported-effort>`; handoff omission records `provider-default`.
- `--max-turns <1-100>` for Grok and Claude; handoff default is 12.
- `--bash true|false`; default is true.
- `--web-search true|false`; default is false and true requires an exact provider control.
- `--mcp-config <absolute-path>`; only invocation-private, adapter-proved MCP mappings are accepted.

Root-only defaults are depth 3, 16 total nodes, 12 advice nodes, 4 handoff nodes, concurrency 4,
30-minute root timeout, and 10-minute per-node timeout. Override with `--max-depth`, `--max-nodes`,
`--max-advice-nodes`, `--max-handoff-nodes`, `--max-concurrency`, `--root-timeout-ms`, and
`--timeout-ms`.

Unsupported combinations fail before provider launch. Never add trust-all, approval bypass,
sandbox bypass, skip-repository-check, resume, ambient MCP, or shared-session flags.

## Result discipline

Stdout and the new result file are byte-identical. `output.response` is the handoff summary;
evidence and findings remain structured. Check process exit, result status, selection/grant receipts,
policy, Git evidence, and DAG state.

Only exit `0` plus `succeeded` is green. Build/phase success without a Git-observable change blocks.
Advice/review/verify mutation blocks. Treat `not_run`, `rejected`, `blocked`, `failed`, `timed_out`,
and `cancelled` as non-green and report the bounded diagnostic instead of substituting local work.
