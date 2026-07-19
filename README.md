# handoff v0.2.1

`handoff` has two deliberately separate surfaces:

- The compatible interactive helper delegates `build` and `review` to Codex, Grok, Kiro, Claude,
  opencode, or Cursor through the existing slash commands and `--provider/--verb/--prompt-file` CLI.
- The v0.2 machine API gives an autonomous coordinator a strict, versioned, fail-closed subprocess
  boundary with an explicit provider/role policy matrix.

Both the Claude and Codex plugin manifests ship version `0.2.1` from this repository.

## Interactive commands (compatible with v0.1)

```text
/handoff:codex-build <request>
/handoff:codex-review <request>
/handoff:grok-build <request>
/handoff:grok-review <request>
/handoff:kiro-build <request>
/handoff:kiro-review <request>
/handoff:claude-build <request>
/handoff:claude-review <request>
/handoff:opencode-build <request>
/handoff:opencode-review <request>
/handoff:cursor-build <request>
/handoff:cursor-review <request>
```

The direct compatible interface is unchanged:

```bash
node /absolute/path/to/handoff/scripts/handoff.mjs \
  --provider codex --verb review \
  --prompt-file /absolute/path/to/brief.md --cwd /absolute/path/to/repository --structured
```

The brief is read as bytes from a file and delivered through stdin or a provider-native file flag;
its contents are never interpolated into a shell command or placed in an argv element. A missing or
nonresponsive binary detected before launch is `gateNotRun`; authentication, provider, or network
errors from a launched process are nonzero run failures. A legacy build still requires a
Git-observable change.

## v0.2 machine API

Invoke the checked-in driver by absolute path. The plugin does not promise or install a `handoff`
executable on `PATH`.

```bash
node /absolute/path/to/handoff/scripts/handoff.mjs capabilities --json

node /absolute/path/to/handoff/scripts/handoff.mjs run \
  --provider grok \
  --role build \
  --cwd /absolute/path/to/git-worktree \
  --request /absolute/path/to/request.json \
  --result /absolute/path/to/new-result.json
```

`capabilities --json` writes exactly one compact JSON object to stdout. It reports the API, driver,
bundle digest, roles, static provider policies, installed provider versions, and flag preflight. Its
installed-version preflight is the runtime authority; `pipeline.safe: true` describes an implemented
adapter, not proof that the currently installed binary passed. A pipeline run refuses to start unless
that preflight is `ok: true`. Codex actively probes strict config-key recognition; Grok locally probes
both named sandbox profiles and the structured-result parser without authentication or network.

`run` accepts `codex` or `grok` for all four roles and Kiro v1 only for `review`/`verify`.
Every flag is required. Unknown or duplicate flags fail closed. `--cwd`, `--request`, and `--result`
must be absolute, lexically safe paths; symlink redirection and `.`/`..` traversal are rejected.
The request must be a regular file. The result must not already exist and is reserved without
following a symlink. Diagnostics go only to stderr or the bounded/redacted result diagnostics; stdout
contains exactly one compact JSON result object. On a valid result path, stdout and the result file are
byte-identical.

### Request contract

The source of truth is [`contracts/v0.2/request.schema.json`](contracts/v0.2/request.schema.json).
Unknown fields are rejected. This is a complete minimal request for Grok, or for a supported Kiro
role:

```json
{
  "schemaVersion": "handoff.request.v0.2",
  "instructions": "Implement the bounded task and return strict structured evidence.",
  "timeoutMs": 600000
}
```

`model` and `effort` are optional provider strings. Every Codex request additionally requires the
following approval object. This example is a shape, not a usable approval: the coordinator must
replace the cwd, rule set, and digest with values bound to the exact request.

```json
{
  "schemaVersion": "handoff.request.v0.2",
  "instructions": "Implement the bounded task and return strict structured evidence.",
  "coordinatorApproval": {
    "schemaVersion": "handoff.coordinator-approval.v0.2",
    "approvalId": "approval-123",
    "issuer": "autonomous-coordinator",
    "provider": "codex",
    "role": "build",
    "cwd": "/absolute/canonical/git-worktree",
    "scope": "all-applicable-agents-rules",
    "subjectHash": "sha256:<64 lowercase hexadecimal characters>",
    "rules": []
  }
}
```

`timeoutMs` is optional and bounded from 100 through 3,600,000 milliseconds. The request hash in the
result is SHA-256 over the exact request-file bytes.

`coordinatorApproval` is required for every Codex machine role and rejected for other providers. Its
`subjectHash` is SHA-256 over the driver's canonical approval subject: approval id/issuer, provider,
role, canonical cwd, scope, every request field except `coordinatorApproval`, and the ordered
`source`/`path`/`sha256` rule identities. The driver recomputes that digest, so changing the task,
role, cwd, or rules after approval fails before provider preflight. This approval-subject digest is
separate from the result's exact request-file hash. Canonicalization is minified JSON with object keys
sorted by raw UTF-8 bytes, array order preserved, integer decimal notation, JSON string escaping, and
no Unicode normalization; the reference implementation is `codexApprovalSubjectHash` in
`scripts/lib/agents-policy.mjs`.

Each rule contains `source` (`repository` or `external`), exact `content`, and its `sha256` digest.
Repository paths are safe Git-root-relative paths; external paths are absolute. Entries must be unique
and byte-sorted by source and path. Following [Codex's documented instruction
hierarchy](https://developers.openai.com/codex/codex-manual.md), the driver checks only the
repository-root-to-`cwd` directory chain, selects `AGENTS.override.md` before `AGENTS.md` at each
level, skips empty files, rejects symlinks, and requires the repository entries to match that
applicable chain exactly. Unrelated nested rules are not promoted to global rules. It then injects the
complete approved JSON set—including coordinator-supplied external/global rules—before the task
instructions. An empty list is valid only when no repository rule applies and the coordinator asserts
no broader rule applies. External/global completeness and coordinator identity remain coordinator
assertions under the documented same-UID threat model; the driver does not claim signature
verification.

### Strict provider and result contracts

Providers must return exactly one object matching
[`contracts/v0.2/provider-output.schema.json`](contracts/v0.2/provider-output.schema.json). Missing,
malformed, noisy, prose-only, oversized, version-drifted, unknown-field, or unsafe evidence output is
an `invalid output` failure. The normalized result follows
[`contracts/v0.2/result.schema.json`](contracts/v0.2/result.schema.json) and always carries:

- schema, driver and bundle versions plus the deterministic bundle digest;
- provider id/version, role, and the exact policy selected;
- the exact request hash, normalized status, driver/provider exit information, and signal state;
- structured evidence/findings and observed token usage (or explicit `not-reported`/`not-observed`
  nulls);
- deterministic before/after Git fingerprints and changed paths;
- wall timing and bounded, credential-redacted diagnostics.

Driver exit mapping is `0` success, `2` provider-declared/nonzero failure, `3` unavailable or failed
capability preflight, `5` rejected request/path/usage, `7` invalid provider/result output, `8` timeout,
`9` cancellation, and `10` policy block (review mutation or a claimed successful build with no
Git-observable change).

### Git evidence

Before and after fingerprints cover HEAD, index records, staged and unstaged content, tracked and
untracked files, deletions, renames, executable modes, and symlink targets. Git paths are consumed as
NUL-delimited bytes, so spaces and newlines are not line-parsed or lost. The driver checks that `cwd`
is a Git worktree before reading HEAD. A `review` or `verify` that changes the supplied worktree is
blocked regardless of the provider's self-report. Handoff does not create that worktree; a coordinator
that requires disposal or process-level isolation must create and confine it before invocation.

## Pipeline policy guarantees

| Provider | `build` / `phase` | `review` / `verify` | Handoff machine defaults |
|---|---|---|---|
| [Codex](https://developers.openai.com/codex/codex-manual.md) | native `workspace-write` sandbox; coordinator approval plus exact `AGENTS.md` injection required | native `read-only` sandbox; the same approval/rule binding required | `exec --ephemeral --strict-config`; user config and execpolicy `.rules` ignored; native AGENTS budget set to zero after config-key preflight; approvals and network disabled; no Git-check skip or dangerous bypass |
| [Grok](https://docs.x.ai/build/enterprise#sandbox) | named built-in `workspace` sandbox | named built-in `read-only` sandbox | cwd pinned, 12 turns, structured schema; web search, subagents, and memory disabled |
| [Kiro v1](https://kiro.dev/docs/cli/custom-agents/configuration-reference/) | **unsupported and rejected before provider launch** | `fs_read` only; no `execute_bash`; tool permission only | no native filesystem-isolation claim, no confinement receipt upgrade, and never `--trust-all-tools` |

### Interactive-only providers

Claude, OpenCode, and Cursor remain available through the compatible interactive helper and are
advertised as `pipeline.safe: false`. That status means this repository has not implemented and
preflighted a v0.2 adapter for them; it is not a claim that their CLIs lack automation or security
features. The following facts were checked against the linked official documentation on 2026-07-19
and cross-checked against installed CLI help where that provider binary was available:

- [Claude Code](https://code.claude.com/docs/en/cli-usage) supports bare scripted execution,
  permission/tool controls, no-session persistence, native Bash sandbox settings, and
  [JSON Schema output](https://code.claude.com/docs/en/headless#get-structured-output). The legacy
  handoff adapter's policy baseline is `-p --output-format json --permission-mode manual|auto`, with
  JSON Schema added only for structured reviews; it does not assemble or preflight the full control
  set as a v0.2 policy.
- [OpenCode](https://opencode.ai/docs/agents/) documents Plan as a restricted, non-mutating agent and
  exposes granular `allow`/`ask`/`deny` [permissions](https://opencode.ai/docs/permissions/). Its
  [config sources](https://opencode.ai/docs/config/) are merged, and `opencode run --format json` is
  documented as raw JSON events. The legacy handoff adapter selects `--agent plan|build` but does not
  isolate merged config or normalize and preflight that event stream against the v0.2 provider schema.
- [Cursor](https://cursor.com/docs/cli/headless) documents that print mode without `--force` proposes
  file changes while `--force` applies them, and its [JSON output](https://cursor.com/docs/cli/reference/output-format)
  is a single result envelope. The installed CLI also exposes a command-execution sandbox. The legacy
  handoff adapter uses text output, omits `--force` for review, and adds it for build; it does not pin
  or isolate Cursor configuration, prove a review sandbox policy, or validate a v0.2 provider object.

### Grok profile scope

[xAI's official Grok Build sandbox table](https://docs.x.ai/build/enterprise#sandbox) defines
`workspace` as read-everywhere with writes to CWD, `/tmp`, and `~/.grok/`, and defines `read-only` as
read-everywhere with writes to Grok state and temp only. Those profile names therefore describe the
repository write boundary, not host-wide immutability or a cwd-only read boundary. xAI documents
Landlock on Linux and Seatbelt on macOS for filesystem enforcement, while child-network blocking for
`read-only` is Linux-only. Handoff reports that narrower network guarantee. Its local preflight proves
that the installed binary initializes each exact named profile and reaches schema parsing; it does not
claim to attest every kernel rule.

A native provider sandbox constrains the delegated provider process, but the handoff protocol is not a
boundary against the coordinator or an independent process running as the same OS user. Those processes
can inspect or interfere outside what the selected native sandbox actually enforces. Use an external
container/VM/OS sandbox when the provider or caller is outside that trust boundary. Grok's built-in
network enforcement is platform-dependent, so the result reports the narrower guarantee instead of
claiming universal network isolation.

## Deterministic bundle and tests

[`bundle-digest.json`](bundle-digest.json) covers the driver, contracts, shared security modules, all
provider adapters, and both manifests in stable path order. Machine commands fail closed if it drifts.

```bash
node scripts/bundle-digest.mjs --check
node --test scripts/test-handoff.mjs scripts/test-pipeline-e2e.mjs
```

The E2E suite uses only temporary Git repositories and fake provider executables on a temporary PATH.
It crosses real subprocess/request/result boundaries and needs no network, provider account, auth, or
global provider configuration.

MIT · ulpi.io
