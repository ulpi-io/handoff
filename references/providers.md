# Provider adapter reference (handoff v0.2)

The legacy interactive helper supports all six providers. The strict machine API advertises only
Codex, Grok, and Kiro as pipeline-safe; capability preflight checks the installed CLI before every
machine run.

## Pipeline adapters

| Boundary | Codex | Grok | Kiro |
|---|---|---|---|
| Binary | `codex` | `grok` | `kiro-cli` |
| Roles | build, phase, review, verify | build, phase, review, verify | build, phase, review, verify |
| Prompt bytes | stdin via trailing `-` | generated `--prompt-file PATH` | stdin |
| build / phase | `--sandbox workspace-write` | `--sandbox workspace --permission-mode auto` | `--trust-tools=fs_read,fs_write,execute_bash` (**permission-only**) |
| review / verify | `--sandbox read-only` | `--sandbox read-only --permission-mode plan` | `--trust-tools=fs_read` (no bash; **permission-only**) |
| Structured result | `--output-schema FILE` and `--output-last-message FILE` | `--json-schema JSON` | strict prompt contract plus exact-JSON parser; prose fails closed |
| Pin cwd | `--cd ABSOLUTE_CWD` and child cwd | `--cwd ABSOLUTE_CWD` and child cwd | child cwd |
| Other hardening | `--ephemeral --ignore-user-config --ignore-rules --config approval_policy="never"` | `--disable-web-search --no-subagents --no-memory --max-turns 12` | never `--trust-all-tools`; no native filesystem-isolation claim |
| Required preflight flags | config, sandbox, cd, ephemeral, ignore-user-config/rules, output schema/message | cwd, named sandbox, JSON schema, max turns, web/subagent/memory disables | non-interactive and trust-tools |

Codex machine execution never uses `--skip-git-repo-check`, `danger-full-access`, or
`--dangerously-bypass-approvals-and-sandbox`.

Grok uses its named built-in `workspace` and `read-only` sandbox profiles. The driver fails preflight
if the installed binary cannot show both named-sandbox selection and structured-result support. Web
search, subagents, and memory are disabled independently of sandbox selection. Network behavior of
the built-in profiles is platform-dependent and is reported honestly in each policy. `workspace`
still permits writes to the pinned cwd, Grok state, and temporary directories; `read-only` protects
the repository but retains Grok-state and temporary-directory writes. Neither profile is described as
a host-wide read boundary.

Kiro tool trust controls approval, not native filesystem access. `review` and `verify` receive only
`fs_read`; `execute_bash` is deliberately absent because arbitrary bash is not read-only. `build` and
`phase` are always labeled `permission-only` unless the request contains a matching
`handoff.external-confinement.v0.2` assertion. Handoff reports such an assertion with
`verifiedByDriver: false`; it does not upgrade Kiro's own tool permissions into a sandbox claim.

## Interactive compatibility adapters

| Primitive | Codex | Grok | Kiro | Claude | opencode | Cursor |
|---|---|---|---|---|---|---|
| Headless invoke | `codex exec … -` | `grok --prompt-file P` | `kiro-cli chat --no-interactive` | `claude -p --output-format json` | `opencode run` | `cursor-agent -p --output-format text` |
| Prompt bytes | stdin | file | stdin | stdin | file | stdin |
| review lever | `-s read-only` | permission plan | `fs_read` allowlist | permission manual | plan agent | no `--force` (best-effort only) |
| build lever | `-s workspace-write` | permission auto | read/write/bash allowlist | permission auto | build agent | `--force` |
| structured review | output schema | JSON schema | prompt contract | JSON schema envelope | prompt contract | prompt contract |
| resume | use native Codex directly | supported | supported | supported | supported | supported |

The compatible CLI remains:

```bash
node /absolute/path/to/handoff/scripts/handoff.mjs \
  --provider <codex|grok|kiro|claude|opencode|cursor> \
  --verb <build|review> --prompt-file /absolute/brief.md --cwd /absolute/git-worktree
```

Provider auth is not inferred from prose. Missing binaries and failed executions remain non-green.
The machine E2E suite replaces every provider with a fake executable and never reads live auth or
global configuration.
