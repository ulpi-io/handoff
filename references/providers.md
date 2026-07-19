# Provider adapter reference (handoff v0.2)

The legacy interactive helper supports all six providers. The strict machine API advertises Codex and
Grok for every role and Kiro v1 for review/verify only; capability preflight checks the installed CLI
before every machine run.

## Pipeline adapters

| Boundary | Codex | Grok | Kiro |
|---|---|---|---|
| Binary | `codex` | `grok` | `kiro-cli` |
| Roles | build, phase, review, verify (coordinator approval required) | build, phase, review, verify | review, verify only |
| Prompt bytes | stdin via trailing `-` | generated `--prompt-file PATH` | stdin |
| build / phase | `--sandbox workspace-write` | `--sandbox workspace --permission-mode auto` | unsupported; rejected before provider launch |
| review / verify | `--sandbox read-only` | `--sandbox read-only --permission-mode plan` | `--trust-tools=fs_read` (no bash; **permission-only**) |
| Structured result | `--output-schema FILE` and `--output-last-message FILE` | `--json-schema JSON` | strict prompt contract plus exact-JSON parser; prose fails closed |
| Pin cwd | `--cd ABSOLUTE_CWD` and child cwd | `--cwd ABSOLUTE_CWD` and child cwd | child cwd |
| Other hardening | `--ephemeral --strict-config --ignore-user-config --ignore-rules`; approvals/network disabled; native AGENTS budget set to zero; coordinator-bound AGENTS rules injected in prompt | `--disable-web-search --no-subagents --no-memory --max-turns 12` | never `--trust-all-tools`; no native filesystem-isolation claim |
| Required preflight | flags plus strict recognition of the approval, project-doc, root-marker, and network config keys | cwd, named sandbox, JSON schema, max turns, web/subagent/memory disables | non-interactive and trust-tools |

Codex machine execution never uses `--skip-git-repo-check`, `danger-full-access`, or
`--dangerously-bypass-approvals-and-sandbox`.

Every Codex machine request must include a `handoff.coordinator-approval.v0.2` object. Its recomputed
subject hash binds approval id/issuer, provider, role, canonical cwd, task fields, and ordered rule
identities. Handoff reconstructs the applicable repository-root-to-cwd instruction chain, including
`AGENTS.override.md` precedence, verifies exact path/content/digest matches, and injects that chain
plus any coordinator-supplied external/global rules into the provider prompt. It passes
`project_doc_max_bytes=0` under `--strict-config` so Codex does not separately load an unbound or
duplicate native AGENTS chain; `--ignore-rules` independently disables execpolicy `.rules` files.
Repository-chain completeness is driver-verified. Broader/global applicability and coordinator
identity are explicit coordinator assertions, not a driver-verified signature.

Grok uses its named built-in `workspace` and `read-only` sandbox profiles. The driver fails preflight
unless each exact profile initializes and the CLI reaches its structured-result parser in a local,
deliberately invalid-schema probe that needs no auth or network. Web
search, subagents, and memory are disabled independently of sandbox selection. Network behavior of
the built-in profiles is platform-dependent and is reported honestly in each policy. `workspace`
still permits writes to the pinned cwd, Grok state, and temporary directories; `read-only` protects
the repository but retains Grok-state and temporary-directory writes. Neither profile is described as
a host-wide read boundary.

Kiro tool trust controls approval, not native filesystem access. Kiro v1 is therefore machine-enabled
only for `review` and `verify`, which receive `fs_read`; `execute_bash` is deliberately absent because
arbitrary bash is not read-only. `build` and `phase` are rejected during CLI validation. No unverified
confinement receipt can upgrade Kiro into a writable pipeline provider.

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

OpenCode and Cursor remain present in this interactive table but are not pipeline-safe. OpenCode lacks
verified filesystem confinement and a native strict-result channel; Cursor lacks a per-run read-only
sandbox and uses `--force` for builds. Claude is likewise interactive-only until its configuration and
permission boundary is hardened for this ABI.
