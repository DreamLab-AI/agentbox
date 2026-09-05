# The algorithm (ADR-020 §Decision, Surface 2)

Seven steps. Steps 1–3 branch; 4–5 score and select; 6 is the **enforced**
spend/candidate/wall-clock cap; 7 records the trajectory.

1. **Generate N candidates.** Invoke `sparc:coder` N times with varied
   temperature or prompt framing. N is capped at `max_candidates` from the
   manifest (default 5); never exceed it.
2. **Fresh kernel per branch.** For each candidate, obtain a clean
   `KernelSession` — call `kernel.reset` before each branch so no state leaks
   from a prior candidate into this one's execution.
3. **Execute the candidate.** Run the candidate's test suite or inline
   assertions via `kernel.exec` (or `aci.run_tests` when the ACI MCP is
   enabled). Capture the `ExecutionTrace`.
4. **Score the branch.** Primary signal: **assertion-pass count**. Secondary
   signals: an exception-free flag, and stdout equality against `expected_output`
   when one is provided.
5. **Select.** Take the highest-scoring candidate; **tie-break on shortest code**
   (fewer lines).
6. **Reserve, then settle, every branch.** The cap is not advice: each branch
   must be admitted by the `tree-search-cap` limiter **before** it is dispatched
   and released **after** it finishes. A refusal (exit 3) halts the remaining
   branches; return the best candidate found so far, annotated
   `{halted: true, reason: "spend_cap"}`. There is no default-unlimited mode —
   an absent `spend_cap_usd` falls back to the documented 0.50 USD default,
   never to infinity. See **Enforced cost cap** below.
7. **Emit the trajectory.** Write the full candidate set and the chosen ID to
   the audit JSONL (`tree-search-<session>-<YYYY-MM-DD>.jsonl`) for downstream
   ExpeL distillation (ADR-019).

## Manifest gate

Enabled in the live manifest but never auto-routed (explicit invocation only); kernel MCP required. From `agentbox.toml`:

```toml
[skills.tree_search_coder]
enabled = true            # E052: requires [skills.code_interpreter].enabled = true
max_candidates = 5        # W051: values > 5 warn — token spend scales linearly with N
per_branch_timeout_s = 60
spend_cap_usd = 0.50      # W052: absent is an ERROR — no default-unlimited mode
```

Emitted identifiers are minted through `management-api/lib/uris.js` (ADR-013):
a run is `urn:agentbox:tree-search:<scope>:<run-id>`, `<scope>` the owning
identity's hex pubkey. Span `agentbox.skill.tree-search-coder.run` carries
`{n_candidates, chosen_id, total_duration_ms, total_cost_usd, halted}`.

## Enforced cost cap (ADR-2020)

`max_candidates`, `per_branch_timeout_s` and `spend_cap_usd` are consumed by a
real limiter — `agentbox_ops::cost_cap` (`services/agentbox-ops/src/cost_cap/`),
exposed as the `tree-search-cap` binary. The orchestration path is a sequence of
short-lived tool calls, so the limiter keeps its accounting in a JSON ledger
guarded by an exclusive `flock`: the cap check and the admission it authorises
are one atomic step across threads *and* processes.

**Per-branch protocol — both calls are mandatory:**

```bash
# BEFORE dispatching branch k (refuses with exit 3 when the cap would break)
tree-search-cap reserve --run "$RUN_ID" --estimate 0.13
# → {"ok": true, "reservation": {"id": "res-…", "candidate_index": 2, "remaining_usd": 0.24}}

# AFTER the branch finishes — on the success path …
tree-search-cap settle --run "$RUN_ID" --reservation res-… --actual 0.11
# … and on the failure/cancel path (the hold must always be released)
tree-search-cap settle --run "$RUN_ID" --reservation res-… --actual 0.00 --failed
```

| Exit | Meaning |
|------|---------|
| `0` | granted / settled |
| `2` | argument or ledger error |
| `3` | **REFUSED** — `spend_cap_exceeded`, `candidate_limit_exceeded`, `branch_timeout`, or `capability_disabled` |

Properties the limiter guarantees, each covered by a test:

- **Reserve-before-dispatch.** A branch's estimate is held against the budget
  for as long as it runs, so concurrent and in-flight branches cannot jointly
  exceed `spend_cap_usd` — with a 0.50 cap, ten concurrent 0.20 reservations
  admit exactly two.
- **Settle on both paths.** `--failed` releases the hold and charges only what
  was actually spent; a double settle is refused as `unknown_reservation`.
- **Wall clock.** A hold that is never settled expires at
  `per_branch_timeout_s` and is charged its **full estimate** — a crashed branch
  never hands back budget it may have burned.
- **Candidate ceiling.** Only granted reservations consume a slot; the
  `max_candidates + 1`-th branch is refused, whatever the spend.
- **Manifest gate.** `enabled = false` refuses every reservation, so the
  capability cannot run uncapped when its gate is off.

Inspect a run with `tree-search-cap status --run "$RUN_ID"`; the effective
config and where each field came from with `tree-search-cap config`.
