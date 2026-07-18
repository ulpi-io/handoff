# Provider adapter cheat-sheet

Every provider reduces to the same 6 primitives; only the middle differs. Verified against:
Codex `codex-cli 0.144.5`, Grok "Grok Build TUI", Kiro `kiro-cli chat`. **Re-confirm flags against
`<cli> --help` when a provider updates** — pin to reality, never to memory.

| Primitive | codex | grok | kiro |
|---|---|---|---|
| Binary (PATH + fallback) | `codex` (`/opt/homebrew/bin`) | `grok` (`~/.grok/bin`) | `kiro-cli` (`~/.local/bin`) |
| Headless invoke | `codex exec … -` | `grok --prompt-file P` | `kiro-cli chat --no-interactive` |
| Prompt as literal bytes | **stdin** (the `-`) | **`--prompt-file P`** (bytes stay in the file) | **stdin** |
| Trust lever | `-s read-only \| workspace-write \| danger-full-access` | `--permission-mode plan \| auto \| bypassPermissions` | `--trust-tools=…` / `--trust-all-tools` |
| review (read-only) | `-s read-only` | `--permission-mode plan` | `--trust-tools=fs_read,execute_bash` |
| build (least-write) | `-s workspace-write` | `--permission-mode auto` | `--trust-tools=fs_read,fs_write,execute_bash` |
| autonomous (opt-in only) | `-s danger-full-access` | `--permission-mode bypassPermissions` | `--trust-all-tools` |
| model / effort | `-m` / (config) | `-m` / `--effort` | `--model` / `--effort` |
| structured findings | `--output-schema FILE` | `--json-schema '<inline>'` | none — ask for JSON in the prompt |
| final message capture | `-o/--output-last-message FILE` | `--output-format json` (stdout) | stdout (markdown) |
| resume | native `codex exec resume` (not via handoff v1) | `-r/--resume [ID]` / `-c` | `-r` / `--resume-id ID` |
| working dir | `-C DIR` | `--cwd DIR` | (process cwd) |
| NEVER default | `--dangerously-bypass-approvals-and-sandbox` | `--permission-mode bypassPermissions` | `--trust-all-tools` |

Notes:
- Codex `exec` is already non-interactive — there is **no** `--full-auto` in 0.144.5; the sandbox policy
  alone gates writes.
- Grok `--sandbox` takes a named *profile* (env `GROK_SANDBOX`), so handoff uses `--permission-mode` as
  the portable trust lever instead of a profile name it can't assume exists.
- Kiro `chat` has no structured-output flag (`--format` is only for `--list-*`), so review findings come
  back as text; the brief asks for a JSON block when structure is needed.

Adding a provider = one `scripts/lib/providers/<name>.mjs` implementing `locate / authOk / invocation /
capture`, plus two command shims. The driver (`scripts/handoff.mjs`) already owns everything else.
