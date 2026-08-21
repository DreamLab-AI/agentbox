# The algorithm (ADR-020 §Decision, Surface 2)

Seven steps. Steps 1–3 branch; 4–5 score and select; 6 enforces the spend cap;
7 records the trajectory.

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
6. **Honour the spend cap.** If `spend_cap_usd` is exceeded mid-search, halt the
   remaining branches and return the best candidate found so far, annotated
   `{halted: true, reason: "spend_cap"}`. There is no default-unlimited mode —
   `spend_cap_usd` is mandatory.
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
