# Security gate — deepsec

The Security gate in [quality-gates-and-workflow.md](./quality-gates-and-workflow.md)
("zero critical/high vulnerabilities") is executed by
[deepsec](https://github.com/vercel-labs/deepsec) (Apache-2.0), an agent-powered
vulnerability reviewer, driven through `scripts/deepsec-gate.sh`. Decision record:
agentbox ADR-2033. The gate is evidence, not narration: every run leaves a
`receipt.json` with the revision, policy, counts and blocking findings.

## Where it comes from

- **Baked** by `[toolchains].deepsec = true` in `agentbox.toml` (`deepsec` on PATH,
  `flake.nix` `deepsecPkg`, exact-version pin; rebuild apply-class).
- **Governed** by `[security.deepsec]` — agent, model route, thinking level,
  `fail_on` severity, `max_duration`, batch/concurrency, provider names. The
  manifest validator enforces the route/toolchain pairings (E070–E072, W070).
- **Reachable** from the harness only through the gate script; `deepsec init` is
  never used inside agentbox (it writes a `.deepsec/` workspace with its own
  `node_modules`, links a Vercel project and can spend without a bound).

## Run it

```bash
G=/opt/agentbox/skills/build-with-quality/scripts/deepsec-gate.sh
$G --diff origin/main            # PR mode: net-new findings on changed files (the merge gate)
$G --diff-working                # what you have not committed yet
$G --scan-only                   # free regex candidate pass; never blocks
$G --full                        # whole repo; bounded by [security.deepsec].max_duration
$G --diff origin/main --dry-run  # print the resolved plan, run nothing
```

Exit codes: `0` pass · `1` blocking findings at or above `fail_on` · `70` deepsec
runtime error · `78` gate disabled or unavailable (record SKIPPED/UNAVAILABLE,
never "passed") · `124` `max_duration` reached (deepsec checkpoints; re-run to resume).

Receipts land in `<repo>/.deepsec-gate/reports/<UTC stamp>/` (gitignored):
`plan.json`, `deepsec.log`, `findings.json`, `comment.md` (PR-comment shaped,
only when findings exist) and `receipt.json`. Cite `receipt.json` as the EDD
evidence for the Security gate; the auditor re-runs `--diff` on the same
revision to verify.

## Model route (names only, never values)

| `model_auth` | Needs | Route written to `.deepsec-gate/deepsec.config.mjs` |
|---|---|---|
| `local` (default) | logged-in `claude` (`[toolchains].claude_code`) or `codex` (`[toolchains].codex`) | `{ mode: "local" }` — no key, no gateway |
| `direct` | `ai_provider = anthropic\|openai`, `ai_api_key_env = NAME` | `{ mode: "direct", provider, apiKeyEnv }` |
| `custom` | `agent = "pi"`, `ai_base_url`, `ai_api_key_env` | `{ mode: "custom", baseUrl, apiKeyEnv, bearer header }` — LAN-only path via the Loom façade (`http://loom:8080/v1`) |

Override any policy key per run with `DEEPSEC_GATE_<KEY>` (e.g.
`DEEPSEC_GATE_FAIL_ON=CRITICAL`, `DEEPSEC_GATE_MODEL=agent:model-a`) or the
matching CLI flag.

## Reading deepsec's own docs

The baked package carries the exact docs for its version. Read them before
changing flags — the CLI contract moves:
`$(dirname "$(readlink -f "$(command -v deepsec)")")/../lib/deepsec/node_modules/deepsec/dist/docs/`
(`reviewing-changes.md` for PR mode and exit codes, `models.md`,
`configuration.md`, `writing-matchers.md`).

## What the gate does not do

- It does not revalidate. For a whole-repo pass, run `deepsec revalidate` from
  `.deepsec-gate/` on `HIGH+` before acting (cuts the 10–29 % FP rate).
- It does not fan out to Vercel Sandbox; the estate keeps model credentials
  host-side and content on the LAN or the operator's own account.
- Its threshold counts exported findings on the reviewed files; deepsec's
  own `net_new_reported_by_deepsec` flag is recorded alongside so a
  pre-existing finding can be distinguished from a regression.
