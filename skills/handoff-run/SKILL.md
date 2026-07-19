---
name: handoff-run
description: |
  Shared workflow behind every /handoff:<provider>-<verb> command. Hands off a BUILD or REVIEW task to
  a one-shot headless agent (Codex, Grok, Kiro, Claude, opencode, or Cursor) through the deterministic driver
  scripts/handoff.mjs. Invoke it when a /handoff:* command fires, or when the user asks to "hand off",
  "delegate to codex/grok/kiro/claude/opencode/cursor", "have grok review", "let kiro build", etc. It scopes the request into
  an injection-safe brief, runs the target CLI with trust scoped to the verb, and reports GROUND TRUTH
  (the real git diff for a build; findings for a review) — never a self-reported clean.
allowed-tools: [Bash, Read, Write, Grep, Glob]
argument-hint: "<provider> <verb> — <what to build or review>"
---

# handoff-run

Delegate one bounded unit of work to an external one-shot agent and report what it ACTUALLY did.

<EXTREMELY-IMPORTANT>
- **Fail closed.** If the driver reports `gateNotRun` (binary missing or nonresponsive before launch),
  that is NOT a pass and NOT a block — report it as "did not run" and stop. Authentication or provider
  failures from a launched process are nonzero failures, never green. Never invent a result.
- **Verify ground truth, never the agent's word.** A build is judged by `git diff --stat <baseline>`
  (the driver prints it); a review by its findings. A build that produced NO diff is a non-completion,
  not success — say so.
- **Trust is scoped to the verb.** Review uses each compatible adapter's narrowest configured mode and
  the driver rejects observed mutation; only the v0.2 provider matrix makes native-sandbox guarantees.
  Build uses the adapter's least-write mode. Do not pass legacy `--mode autonomous`; the v0.2 machine
  API never selects Codex danger-full-access or Kiro trust-all-tools, and pipeline policy must not be
  widened to make a run pass.
- **The brief is data, not code.** Always write it to a file with the Write tool and pass
  `--prompt-file`. Never inline the request into the shell command or an argv element.
- Bounded: one handoff = one build or one review of one scoped unit. Do not loop unattended.
</EXTREMELY-IMPORTANT>

You are given a **provider** (`codex|grok|kiro|claude|opencode|cursor`), a **verb** (`build|review`), and the user's **request**.

## Phase 1 — Scope the request into a brief

Turn the request into a tight, self-contained brief. Include:
- **Goal** — one sentence.
- **In scope** — the exact files/dirs/paths (list them; use Grep/Glob/Read to ground this in the repo).
- **Acceptance criteria** — for `build`, the machine-checkable done-conditions; for `review`, what to
  scrutinize (correctness, security, tests, perf).
- **Guardrails** — for `build`: only touch in-scope files, keep changes minimal, run the tests; for
  `review`: read-only, do not modify anything, return findings.
- For `review`, instruct the agent to return findings; when structured output is wanted, ask for a JSON
  object `{ "findings": [ { "file", "line", "severity": "blocker|high|medium|low|nit", "summary" } ] }`.

Success criterion: the brief is complete enough that the external agent needs no follow-up questions.

## Phase 2 — Write the brief to a file (injection-safe)

Use the **Write** tool to save the brief to a temp file, e.g. `.ulpi/handoffs/<provider>-<verb>.md`
(create the dir if needed). Do not echo the brief through the shell.

Success criterion: the file exists and holds the full brief.

## Phase 3 — Run the driver

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" \
  --provider <provider> --verb <verb> \
  --prompt-file <the file from Phase 2> \
  --cwd "$(pwd)" \
  # review: add --structured   ·   optional: --model <M> --effort <E>
```

The driver locates the CLI, probes auth, records the baseline (build), invokes the agent with the prompt
on stdin/`--prompt-file` and trust scoped to the verb, then prints the honest report. Do NOT add
`--mode autonomous` unless the user asked for it.

Success criterion: the driver ran and printed either a report or an honest `gateNotRun`.

### Coordinator/machine invocation

When the caller is an autonomous coordinator, do not translate its request back into the interactive
`--verb` surface. Use the v0.2 file ABI by absolute driver path:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" capabilities --json
node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/scripts/handoff.mjs" run \
  --provider <codex|grok|kiro> --role <build|phase|review|verify> \
  --cwd <absolute-git-worktree> --request <absolute-request.json> --result <absolute-new-result.json>
```

The request must match `contracts/v0.2/request.schema.json`; do not add ad-hoc fields. Every Codex
machine request must carry a coordinator approval subject hash binding the exact task, role, cwd, and
applicable `AGENTS.md`/`AGENTS.override.md` rule set; Kiro v1 accepts only review/verify. The result path
must not exist. Consume the one stdout JSON object or the byte-identical result file, check the driver
exit/status, and treat any preflight, schema, output, timeout, cancellation, or mutation failure as
non-green. Claude, opencode, and Cursor are interactive-only and must not be selected for this ABI.

Machine policy is fixed by provider and role: Codex uses native workspace-write/read-only with
ephemeral ignored-config execution and no approvals, but it runs only after the coordinator approval
binds and the driver injects the exact repository-root-to-cwd instruction chain. Native Codex AGENTS
loading is set to zero using strictly preflighted config keys; `--ignore-rules` covers execpolicy
`.rules`, not AGENTS guidance. Grok uses an explicit
workspace/read-only named sandbox with web/subagents/memory disabled and bounded turns; Kiro v1
review/verify receives only `fs_read`, and Kiro build/phase is rejected before launch. Kiro tool
permissions are never filesystem-isolation proof. Claude, OpenCode, and Cursor remain interactive-only.

## Phase 4 — Verify and report

- **gateNotRun / nonzero exit** → tell the user it did not complete, with the driver's reason. Never green.
- **build** → read the printed `git diff --stat <baseline>`; if it changed nothing, report non-completion.
  Optionally show `git diff <baseline>` for the actual changes. The changes are UNCOMMITTED — leave
  committing to the user / the normal flow.
- **review** → present the findings as-is; do not act on them here (that would be a separate build handoff).

## Guardrails

- Never escalate trust to get a task to pass. Never auto-install a missing CLI (the driver refuses; relay
  the install hint).
- Never add a dangerous sandbox bypass, skip the Git-repository check, or use Kiro trust-all-tools.
- Never report a handoff as done on the agent's say-so — only on the diff/findings the driver surfaced.
- One scoped unit per handoff; if the request is large, scope it down or split it, don't hand off the world.

## Output Contract

Report: which provider/verb ran, the trust level used, whether it actually ran, and the ground-truth
result (diff summary for build / findings for review) — or an explicit "did not run" with the reason.
