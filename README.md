# handoff v0.4.0

Handoff lets an agent ask another model for read-only advice or delegate a bounded build/review
through one fail-closed Node entrypoint. It supports Codex, Grok, Kiro, Claude, OpenCode, and Cursor.

Version 0.4 adds operation-aware v0.3 contracts, model/effort/turn selection receipts, explicit
Bash/web/MCP grants, and an ephemeral supervisor-owned DAG. The v0.2 machine ABI remains available
for existing integrations.

## Installation

Install from the [Ulpi plugin marketplace](https://github.com/ulpi-io/marketplace).

### Claude Code

```text
/plugin marketplace add ulpi-io/marketplace
/plugin install handoff@ulpi
```

### Codex

```bash
codex plugin marketplace add ulpi-io/marketplace
codex plugin add handoff@ulpi
```

Each plugin resolves from its own repository. Updating Handoff means pushing to this repository, not
the marketplace repository.

## No global CLI

The plugin does not register a global `handoff` executable. Both hosts call the checked-in MJS file:

```text
node ${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs ...
```

Prompt bytes live in a private instruction file, never provider argv.

## Get read-only advice

Any supported harness can ask any compatible target harness for advice:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" advice \
  --caller-harness codex \
  --harness claude \
  --cwd "$(pwd -P)" \
  --instructions /absolute/private/instructions.txt \
  --model fable \
  --effort max \
  --max-turns 32 \
  --bash true \
  --web-search true \
  --result /absolute/private/advice-result.json
```

Advice is structurally read-only. The answer is `output.response`; evidence and findings remain
separate arrays. Advice cannot gain write authority even when the target can build.

`--caller-harness` is explicit root lineage metadata, not authentication. The selected provider
uses its own native logged-in CLI or API-key precedence.

## Run a higher-level handoff

A Codex or Claude root can delegate `build`, `phase`, `review`, or `verify`:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" run \
  --caller-harness codex \
  --harness grok \
  --mode build \
  --cwd "$(pwd -P)" \
  --instructions /absolute/private/instructions.txt \
  --model grok-code-fast \
  --effort high \
  --max-turns 24 \
  --result /absolute/private/handoff-result.json
```

Build/phase must produce a Git-observable change. Advice/review/verify block if the supplied
worktree changes. Only driver exit `0` plus result status `succeeded` is green.

## Nested calls and DAG lineage

Each root starts one temporary supervisor. It owns capability tokens, budgets, lineage, dependency
state, and an audit snapshot outside provider-writable paths. It is not a persistent daemon.

```text
root frontend
  -> private v0.3 request
  -> ephemeral supervisor (DAG + capabilities)
  -> one machine executor
  -> provider CLI
       -> authenticated local IPC for a nested request
       -> the same supervisor and machine executor
```

When `HANDOFF_SUPERVISOR_CONTEXT` is present, workers omit caller and root budgets:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" advice \
  --harness codex \
  --cwd "$(pwd -P)" \
  --instructions /absolute/private/nested-instructions.txt \
  --dependency advises:run-123 \
  --result /absolute/private/nested-result.json
```

Dependencies are repeatable and typed as `requires:<run-id>`, `advises:<run-id>`, or
`verifies:<run-id>`. The supervisor derives caller, root, parent, and depth. Workers cannot author
those fields, widen parent grants, raise root budgets, repeat an ancestor intent, or bypass the
machine executor. Cancellation terminalizes outstanding nodes and removes the local endpoint and
runtime state.

The same-UID threat model remains explicit: the capability protocol does not defend against a
compromised coordinator or another process running as the same OS user. Use a container or VM when
that actor is outside the trust boundary.

## Selection defaults

| Operation/target | Model | Effort | Max turns |
|---|---|---|---|
| Advice to Codex, Claude, or Kiro | provider default | `max` | Claude 32; others provider default |
| Advice to Grok | provider default | provider default | 32 |
| Advice to OpenCode or Cursor | provider default | provider default | provider default |
| Handoff to any target | provider default | provider default | Grok/Claude 12; others provider default |

Override with `--model`, `--effort`, and `--max-turns`. Explicit unsupported values reject before
adapter lookup. Cursor has no exact effort control. Only Grok and Claude expose an exact 1–100 turn
control.

## Grants and budgets

`--bash true|false` defaults true. `--web-search true|false` defaults false. An omitted
`--mcp-config` means an empty MCP set. Nested grants can only narrow the parent's resolved grants.
Unsupported combinations return non-green before provider launch.

Root budgets and defaults are:

| Flag | Default |
|---|---:|
| `--max-depth` | 3 |
| `--max-nodes` | 16 |
| `--max-advice-nodes` | 12 |
| `--max-handoff-nodes` | 4 |
| `--max-concurrency` | 4 |
| `--root-timeout-ms` | 1,800,000 |
| `--timeout-ms` | 600,000 |

Nested commands cannot set these flags.

## Private MCP descriptor

`--mcp-config` accepts a strict `handoff.mcp.v0.3` JSON descriptor. It contains environment
references, not literal secrets:

```json
{
  "schemaVersion": "handoff.mcp.v0.3",
  "servers": [
    {
      "name": "local-docs",
      "transport": "stdio",
      "command": "/usr/bin/env",
      "args": ["node", "/absolute/path/server.mjs"],
      "env": { "TOKEN": { "fromEnv": "DOCS_MCP_TOKEN" } }
    },
    {
      "name": "remote-search",
      "transport": "http",
      "url": "https://mcp.example.com/rpc",
      "headers": { "Authorization": { "fromEnv": "SEARCH_MCP_AUTH" } }
    }
  ]
}
```

The driver identity-checks the source, copies it mode `0600`, hash-binds the server list, translates
it into an invocation-private provider configuration, and excludes secret bytes from prompts,
results, and argv. Providers without a proved private configuration surface reject MCP.

## Result contract

v0.3 providers return `handoff.provider-output.v0.3` with `response`, `evidence`, `findings`, and
`usage`. Handoff normalizes that into `handoff.result.v0.3` with:

- exact request-byte `requestHash` and lineage-independent semantic `intentHash`;
- caller/target/mode, resolved selection and grant receipts, and provider policy;
- `output.response` (advice answer or handoff summary), evidence, and findings;
- Git before/after fingerprints, timing, usage, exit state, and redacted diagnostics;
- the supervisor DAG snapshot when available.

Stdout is one compact JSON line and is byte-identical to the newly reserved result file. Driver exits
are `0` success, `2` provider failure/block, `3` unavailable, `5` rejected input, `7` invalid output,
`8` timeout, `9` cancellation, and `10` policy block.

## Capability discovery

The original command remains byte-compatible:

```bash
node scripts/handoff.mjs capabilities --json
```

Request the v0.3 selection/grant view explicitly:

```bash
node scripts/handoff.mjs capabilities --json --version v0.3
```

See [the provider matrix](references/providers.md) for exact controls and isolation boundaries.

## Legacy v0.2 ABI

Existing callers can keep preparing `handoff.request.v0.2` with `scripts/prepare-request.mjs` and
executing:

```bash
node scripts/handoff.mjs run \
  --provider grok --role review --cwd /absolute/worktree \
  --request /absolute/private/request.json \
  --result /absolute/private/result.json
```

The v0.2 request/provider/result shapes, strict path handling, exit mapping, Git evidence, and output
normalization remain in place.

## Validation

```bash
node scripts/bundle-digest.mjs --check
node --test scripts/test-pipeline-e2e.mjs
node --test scripts/test-release-v04.mjs
```

The installed capability suite performs local help/config/sandbox probes only. It makes no model
call, authenticated web request, or ambient configuration mutation.

MIT · ulpi.io
