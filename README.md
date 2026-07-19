# handoff v0.2

`handoff` has two deliberately separate surfaces:

- The compatible interactive helper delegates `build` and `review` to Codex, Grok, Kiro, Claude,
  opencode, or Cursor through the existing slash commands and `--provider/--verb/--prompt-file` CLI.
- The v0.2 machine API gives an autonomous coordinator a strict, versioned, fail-closed subprocess
  boundary for the hardened Codex, Grok, and Kiro adapters.

Both the Claude and Codex plugin manifests ship version `0.2.0` from this repository.

## Interactive commands (compatible with v0.1)

```text
/handoff:codex-build     <request>    /handoff:codex-review     <request>
/handoff:grok-build      <request>    /handoff:grok-review      <request>
/handoff:kiro-build      <request>    /handoff:kiro-review      <request>
/handoff:claude-build    <request>    /handoff:claude-review    <request>
/handoff:opencode-build  <request>    /handoff:opencode-review  <request>
/handoff:cursor-build    <request>    /handoff:cursor-review    <request>
```

The direct compatible interface is unchanged:

```bash
node /absolute/path/to/handoff/scripts/handoff.mjs \
  --provider codex --verb review \
  --prompt-file /absolute/path/to/brief.md --cwd /absolute/path/to/repository --structured
```

The brief is read as bytes from a file and delivered through stdin or a provider-native file flag;
its contents are never interpolated into a shell command or placed in an argv element. Missing or
unusable CLIs remain `gateNotRun`, and a legacy build still requires a Git-observable change.

## v0.2 machine API

Invoke the checked-in driver by absolute path. The plugin does not promise or install a `handoff`
executable on `PATH`.

```bash
node /absolute/path/to/handoff/scripts/handoff.mjs capabilities --json

node /absolute/path/to/handoff/scripts/handoff.mjs run \
  --provider codex \
  --role build \
  --cwd /absolute/path/to/git-worktree \
  --request /absolute/path/to/request.json \
  --result /absolute/path/to/new-result.json
```

`capabilities --json` writes exactly one compact JSON object to stdout. It reports the API, driver,
bundle digest, roles, static provider policies, installed provider versions, and flag preflight. A
pipeline run refuses to start when the selected installed CLI cannot prove its required flags.

`run` accepts only `codex`, `grok`, or `kiro` and the roles `build`, `phase`, `review`, or `verify`.
Every flag is required. Unknown or duplicate flags fail closed. `--cwd`, `--request`, and `--result`
must be absolute, lexically safe paths; symlink redirection and `.`/`..` traversal are rejected.
The request must be a regular file. The result must not already exist and is reserved without
following a symlink. Diagnostics go only to stderr or the bounded/redacted result diagnostics; stdout
contains exactly one compact JSON result object. On a valid result path, stdout and the result file are
byte-identical.

### Request contract

The source of truth is [`contracts/v0.2/request.schema.json`](contracts/v0.2/request.schema.json).
Unknown fields are rejected.

```json
{
  "schemaVersion": "handoff.request.v0.2",
  "instructions": "Implement the bounded task and return strict structured evidence.",
  "timeoutMs": 600000,
  "model": "optional-provider-model",
  "effort": "optional-provider-effort"
}
```

`timeoutMs` is optional and bounded from 100 through 3,600,000 milliseconds. The request hash in the
result is SHA-256 over the exact request-file bytes.

Kiro can additionally receive an external-confinement assertion:

```json
{
  "externalConfinement": {
    "schemaVersion": "handoff.external-confinement.v0.2",
    "receiptId": "receipt-123",
    "issuer": "coordinator-sandbox",
    "policy": "workspace-write",
    "cwd": "/the/same/canonical/cwd"
  }
}
```

For `review`/`verify`, the receipt policy must be `read-only`; for `build`/`phase`, it must be
`workspace-write`. Handoff validates and reports the assertion but cannot independently authenticate
its issuer (`verifiedByDriver: false`).

### Strict provider and result contracts

Providers must return exactly one object matching
[`contracts/v0.2/provider-output.schema.json`](contracts/v0.2/provider-output.schema.json). Missing,
malformed, noisy, prose-only, oversized, version-drifted, unknown-field, or unsafe evidence output is
an `invalid output` failure. The normalized result follows
[`contracts/v0.2/result.schema.json`](contracts/v0.2/result.schema.json) and always carries:

- schema, driver and bundle versions plus the deterministic bundle digest;
- provider id/version, role, and the exact policy selected;
- the exact request hash, normalized status, driver/provider exit information, and signal state;
- structured evidence/findings and observed token usage (or explicit `not-reported` nulls);
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
is a Git worktree before reading HEAD. A `review` or `verify` that changes its disposable worktree is
blocked regardless of the provider's self-report.

## Pipeline policy guarantees

| Provider | `build` / `phase` | `review` / `verify` | Other defaults |
|---|---|---|---|
| Codex | native `workspace-write` sandbox | native `read-only` sandbox | `exec --ephemeral`, `--ignore-user-config`, `--ignore-rules`, `approval_policy="never"`; never skip the Git-repository check or select a dangerous bypass |
| Grok | named built-in `workspace` sandbox | named built-in `read-only` sandbox | cwd pinned, 12 turns, structured schema; web search, subagents, and memory disabled |
| Kiro | `fs_read,fs_write,execute_bash` tool allowlist; reported as **permission-only** without an external receipt | `fs_read` only; no `execute_bash` | no native filesystem-isolation claim and never `--trust-all-tools` |

Claude, opencode, and Cursor remain fully available through the interactive helper but are explicitly
advertised as `pipeline.safe: false`. Cursor review remains best-effort because its headless CLI has no
native read-only lever.

Grok profile names describe repository policy, not a claim that every byte on the host is immutable:
the built-in `workspace` profile can write the pinned cwd plus Grok state and temporary directories;
the built-in `read-only` profile keeps Grok state and temporary directories writable while protecting
the repository. Both profiles can read more broadly than the cwd. See the installed Grok version's
sandbox documentation for its platform-specific kernel mechanism.

These policies constrain the delegated provider process; they are not a same-UID security boundary.
The provider, handoff, the coordinator, and other processes running as the same OS user can inspect or
interfere with one another outside what a provider's native sandbox actually enforces. Use an external
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
