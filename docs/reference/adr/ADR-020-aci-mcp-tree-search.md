# ADR-020: ACI MCP and execution-gated tree-search

**Status:** Proposed
**Date:** 2026-05-20
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-018 (Persistent code-interpreter MCP — hard dependency), ADR-019 (Experiential skill learning — soft dependency), ADR-005 (Pluggable adapter architecture), ADR-008 (Privacy filter), ADR-012 (JSON-LD encoder), ADR-013 (Canonical URI grammar), ADR-015 (MCP RuVector mandate), PRD-008 §3.2 and §3.6, DDD-005 (Code-execution domain)

---

## TL;DR

Two coupled surfaces are proposed here. Surface 1 is a SWE-agent-style Agent-Computer Interface (ACI) MCP (`mcp/aci-shell/`) that replaces raw `Edit` and `Bash` with five agent-tuned tools: bounded file viewing, compact-diff editing, budget-capped search, test execution, and task submission. Surface 2 is an execution-gated tree-search skill (`skills/tree-search-coder/`) that generates N candidate programs, scores each by execution outcome, and selects the best branch.

The two surfaces are coupled because both verify candidates through the ADR-018 kernel: `aci.run_tests` routes test execution into a fresh KernelSession, and tree-search scores branches by assertion-pass counts obtained from the same kernel. Without the ADR-018 kernel MCP, both surfaces degrade to repeated stateless Bash calls and lose the execution-grounded scoring that makes them valuable.

Both are Phase 2 (build-next). This ADR is deliberately `Proposed`, not `Accepted`, because ADR-018 must reach its Phase 1 acceptance gate before implementation of either surface begins. The wire contracts are pinned now to unblock PRD-008 traceability — in particular the §4 surface table (rows 5 and 6), §6 Phase 1 Track C, and §7 acceptance criteria E1–E5 and F1–F3.

**If you remember only one thing:** these two surfaces are Phase 2 — they require the ADR-018 kernel to verify candidates, so this ADR's implementation is deliberately deferred but the wire contracts are pinned now to unblock PRD-008 traceability.

---

## Context

### Why a constrained ACI outperforms raw shell access

Yang et al. (SWE-agent, arXiv 2405.15793) demonstrated that replacing a raw shell interface with a purpose-designed Agent-Computer Interface lifts autonomous bug-fixing on SWE-bench from roughly 3% pass@1 (non-interactive LM baselines) to 12.5% pass@1 — approximately a four-fold improvement. The key insight is not that the underlying tools are more powerful, but that the action space is constrained to agent-legible affordances: a file editor that shows only the changed lines plus a fixed context window, a search interface that enforces a hard result budget, and a compact diff view that prevents the agent from having to parse full file contents.

The convergence shortlist (namespace `code-harness-survey`, key `convergence-shortlist`) classifies the SWE-agent ACI as `build-next` with `leverage_rank: 5` and records the gap it addresses as follows: "No ACI-style constrained shell interface for agent-driven code editing — agentbox exposes raw Edit/Bash tools without agent-tuned affordances."

The existing codebase-memory MCP (`trace_path`, `search_graph`, `get_code_snippet`) provides read-only structural graph queries. It does not provide the write-exec-test loop with bounded affordances that the ACI pattern requires. The two are complementary: codebase-memory for navigating the repo graph; ACI for editing and testing within it.

### Why execution-gated tree-search adds lift on hard generation tasks

ORPS (Qin et al., arXiv 2412.15118) introduces a tree-structured search that generates strategic code alternatives, executes each candidate, and scores by runtime metrics — achieving +26.9% correctness and +42.2% code efficiency across five models and three benchmarks, without any fine-tuning. Tree-of-Code (arXiv 2412.15305) reports approximately +20% accuracy gains with fewer turns via a similar branching-and-pruning approach.

The convergence shortlist records tree-search's risk as: "Cost multiplier if N is too high; must be opt-in (slow path). Dependency on code-interpreter MCP is hard — without a persistent kernel the pattern degrades to repeated Bash calls."

Agentbox's existing `verification-quality`, `sparc:coder`, and `build-with-quality` check a single candidate rather than exploring and ranking a tree of alternatives. Tree-search closes that gap.

### What agentbox currently lacks

| Gap | Consequence |
|---|---|
| No constrained-action interface for repo-level editing | Agent burns tokens parsing raw file contents; error rate on large-repo tasks elevated |
| No execution-gated branching at the code-generation step | Single-candidate generation misses +26.9% correctness available from ranked multi-candidate search |
| No ACI-style test runner with structured parse output | `aci.run_tests` structured response (passed/failed/errors counts) is not available via bare `Bash` |

### Phase dependency rationale

PRD-008 §6 classifies ACI (Track C) as Phase 1 parallel with ADR-018 (Track A) and ADR-019 (Track B). This ADR revises that classification for the following reason: both surfaces in this ADR use the ADR-018 kernel as the verification signal. The ACI's `aci.run_tests` tool routes through the kernel MCP to obtain structured pass/fail counts rather than raw stdout, ensuring the audit trail and observability binding are consistent. Tree-search depends on this even more directly. Implementing either surface before the kernel MCP is stable produces a weaker, non-auditable approximation. The status `Proposed` reflects this dependency honestly.

---

## Decision

### Surface 1: ACI MCP (`mcp/aci-shell/`)

**MCP name:** `aci-shell`
**Transport:** stdio (spawned by Claude Code per session)
**Process:** Node.js thin wrapper over Edit, Bash, and codebase-memory tools
**Lifetime:** per-session; stateless per call; no kernel process of its own

Five tools, all dispatched through ADR-005 middleware, all writing to a per-session audit JSONL.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `aci.view_file` | `path: string, start_line: integer = 1, max_lines: integer = 150` | `{ok: bool, content: string, total_lines: integer}` | Hard cap of 150 lines per call enforced server-side; forces structured exploration rather than full-file reads |
| `aci.edit_file` | `path: string, start_line: integer, end_line: integer, replacement: string` | `{ok: bool, diff: string, lines_changed: integer}` | Returns compact unified diff with ±5 lines of unchanged context; never the full file |
| `aci.search_repo` | `query: string, path_glob: string = "**", max_results: integer = 20` | `{ok: bool, matches: [{file: string, line: integer, text: string}], total_found: integer}` | Truncates at `max_results`; reports `total_found` so agent knows whether the budget was hit |
| `aci.run_tests` | `command: string, timeout_ms: integer = 60000` | `{ok: bool, passed: integer, failed: integer, errors: integer, output: string, trace_urn: string}` | Command is validated against `test_command_allowlist`; routes to ADR-018 kernel MCP for execution; emits a `trace_urn` (`urn:agentbox:aci:<scope>:<session-id>`) in the response for audit linkage |
| `aci.submit` | `summary: string` | `{ok: bool, submission_id: string, status: string}` | Closes the ACI session; marks the trajectory terminal for downstream ExpeL distillation (ADR-019); `submission_id` is a `urn:agentbox:aci:<scope>:<session-id>` |

**Manifest gates:**

```toml
[skills.aci_shell]
enabled = false
max_view_lines = 150
max_edit_context = 10
test_command_allowlist = ["pytest", "cargo test", "npm test", "go test"]
```

**Validator additions (extending ADR-005's error-code registry):**

| Code | Condition |
|---|---|
| `E050` | `skills.aci_shell.enabled = true` requires `skills.code_interpreter.enabled = true` (kernel MCP must be live for `aci.run_tests` routing) |
| `E051` | `skills.aci_shell.test_command_allowlist` must be non-empty when `skills.aci_shell.enabled = true` |
| `W050` | `skills.aci_shell.max_view_lines` > 200 is accepted but warns that values above 150 defeat the agent-tuned affordance intent of the ACI |

**Implementation layout:**

```
mcp/aci-shell/
├── server.js               # MCP stdio server; thin orchestration layer
├── tools/
│   ├── view-file.js        # bounded file reader; enforces max_view_lines
│   ├── edit-file.js        # line-range editor; emits compact diff
│   ├── search-repo.js      # agent-tuned grep; enforces max_results
│   ├── run-tests.js        # command allowlist check + kernel MCP dispatch
│   └── submit.js           # session close; audit finalisation
├── audit.js                # JSONL writer; ADR-005 observability binding
└── README.md               # operator guide; tool affordances; routing guidance
```

### Surface 2: Execution-gated tree-search skill (`skills/tree-search-coder/`)

A skill with no MCP server of its own. It composes the ADR-018 kernel MCP and, optionally, the ACI MCP. It is invoked explicitly — never auto-routed.

**Algorithm:**

1. Generate N candidate solutions by invoking `sparc:coder` N times with varied temperature or prompt framing (N capped at `max_candidates` from manifest, default 5).
2. For each candidate, spawn a fresh KernelSession via the ADR-018 kernel MCP (`kernel.reset` before each branch to clear state).
3. Execute the candidate's test suite or inline assertions via `kernel.exec`.
4. Score each branch: primary signal is assertion-pass count; secondary signals are exception-free flag and stdout match against `expected_output` if provided.
5. Select the highest-scoring candidate; tie-break on shortest code (fewer lines).
6. If `spend_cap_usd` is exceeded mid-search, halt remaining branches and return the best candidate found so far with a `{halted: true, reason: "spend_cap"}` annotation.
7. Emit the full candidate set and chosen ID to the audit JSONL.

**Manifest gates:**

```toml
[skills.tree_search_coder]
enabled = false
max_candidates = 5
per_branch_timeout_s = 60
spend_cap_usd = 0.50
```

**Validator additions:**

| Code | Condition |
|---|---|
| `E052` | `skills.tree_search_coder.enabled = true` requires `skills.code_interpreter.enabled = true` |
| `W051` | `skills.tree_search_coder.max_candidates` > 5 is accepted but warns that token spend scales linearly with N |
| `W052` | `skills.tree_search_coder.spend_cap_usd` absent is an error; it must be explicit — there is no default-unlimited mode |

**Implementation layout:**

```
skills/tree-search-coder/
└── SKILL.md                # when to choose; algorithm; ICL exemplars (3 examples)
                            # explicit "when NOT to choose" guidance to prevent
                            # collision with sparc:coder, build-with-quality, Edit
```

### Both surfaces inherit

- **ADR-018 trace-as-reward verification signal.** Execution outcome (assertion pass, exception type, stdout) is the primary scoring and verification signal. No LLM judge in the critical path.
- **ADR-005 observability middleware.** One span, one log line, and one metric counter per dispatch. Applied unconditionally when the feature is enabled.
- **ADR-008 privacy filter.** Applied at the `outbound` slot before code body or file content appears in any exporter when `[privacy_filter].enabled = true`.
- **ADR-012 JSON-LD encoder.** Applied at the standard middleware position (after privacy filter) on all adapter dispatches.
- **ADR-013 URN grammar.** All emitted identifiers minted through `management-api/lib/uris.js`:
  - ACI session: `urn:agentbox:aci:<scope>:<session-id>`
  - Tree-search run: `urn:agentbox:tree-search:<scope>:<run-id>`
  - `<scope>` is the hex pubkey of the owning identity (did:nostr substrate, per ADR-013).

---

## Observability

### ACI MCP

Per-tool metrics and spans follow the naming convention established in ADR-018 (`agentbox.mcp.<component>.<op>`):

| Signal | Name | Labels / Attributes |
|---|---|---|
| Span | `agentbox.mcp.aci_shell.<tool>` | `tool, path\|query, exit_kind, duration_ms` (segment uses snake_case to match `[skills.aci_shell]` TOML key and ADR-018 precedent) |
| Log | one JSON line per dispatch at `info`/`error` | `tool, path\|query, exit_kind, duration_ms, session_id` |
| Counter | `agentbox_aci_calls_total` | `{tool, outcome}` |
| Histogram | `agentbox_aci_duration_ms` | `{tool}` |

The PRD-008 §9 surface-level metric `code_harness_aci_calls_total{tool, outcome}` is satisfied by the counter above (same cardinality, same label set).

### Tree-search skill

| Signal | Name | Attributes |
|---|---|---|
| Span | `agentbox.skill.tree-search-coder.run` | `n_candidates, chosen_id, total_duration_ms, total_cost_usd, halted` |
| Counter | `agentbox_tree_search_branches_total` | `{n, outcome}` |
| Histogram | `agentbox_tree_search_duration_ms` | — |

### Audit JSONL

Paths follow the convention established in PRD-008 §9:

| File pattern | Written by |
|---|---|
| `aci-<session>-<YYYY-MM-DD>.jsonl` | ACI MCP (`mcp/aci-shell/audit.js`) |
| `tree-search-<session>-<YYYY-MM-DD>.jsonl` | Tree-search skill |

Record schemas are defined in PRD-008 §3.2 (ACI) and §3.6 (tree-search). This ADR defers to PRD-008 as the canonical record shape definition; the ADR does not duplicate them.

---

## Consequences

### Positive

- Unlocks SWE-bench-Lite class workloads. The ACI's constrained-action surface gives the coordinator-agent the affordances needed for autonomous multi-file bug-fixing without raw file-content parsing overhead.
- Closes the +26.9% correctness gap on hard code generation. Tree-search with execution scoring selects the best of N candidates rather than committing to the first.
- Both surfaces produce structured, auditable trajectories that feed into ADR-019 ExpeL lesson extraction without additional instrumentation.
- The ACI's `aci.submit` marks trajectory endpoints cleanly, enabling future ReasoningBank replay without heuristic session-boundary detection.
- Constrained tooling reduces the agent's token consumption on navigation tasks: `aci.view_file` with a 150-line budget costs far less than reading an entire file to find one function.

### Negative

- Tree-search multiplies token spend by N. At N=5, a task that costs $0.10 under single-candidate generation costs up to $0.50. The `spend_cap_usd` manifest key is mandatory for this reason; there is no default-unlimited mode.
- The ACI MCP is an additional entry in the skill-router's decision tree. Without explicit "when to choose" guidance it will collide with `sparc:coder`, `build-with-quality`, and direct `Edit`/`Bash`. The `SKILL.md` for tree-search-coder must carry a detailed negative-routing section before Phase 2 ships (see PRD-008 §8 risk table, row "ACI MCP confused with codebase-memory MCP by skill-router").
- Both surfaces depend on ADR-018. If the kernel MCP is delayed, neither surface can ship in its intended form; the degraded Bash-backed approximation is explicitly not acceptable (loses audit trail and structured scoring).
- `aci.run_tests` routing through the kernel MCP means that a kernel crash during a tree-search branch kills that branch's scoring. Supervisor auto-restart (ADR-018 §Rollout) mitigates but does not eliminate this.

### Neutral

- The codebase-memory MCP (`trace_path`, `search_graph`, `get_code_snippet`) is not deprecated or modified. The intended usage pattern for autonomous bug-fixing is: use codebase-memory for structural navigation, then switch to ACI for the edit-and-test loop. PRD-008 §10 open question 7 mandates a routing example documenting this pattern before Phase 2 ships.
- `sparc:coder` is not deprecated. Tree-search invokes it N times internally. For tasks where a single attempt is appropriate, `sparc:coder` remains the correct route.

---

## Alternatives Considered

### Full SWE-agent CLI as a dropped-in subprocess

Run the open-source SWE-agent repository as a subprocess, wrapping it in a thin MCP shell.

- **Pros:** Minimal implementation effort; benefits from upstream improvements.
- **Cons:** Bypasses the agentbox MCP audit trail entirely; user-isolation is broken (subprocess inherits devuser environment); the SWE-agent CLI's own action loop cannot be observed or instrumented by ADR-005 middleware; no `urn:agentbox` IDs on emitted artefacts. Explicitly listed as a non-candidate in the convergence shortlist for the audit-trail reason.
- **Rejected.**

### Raw `Edit` + `Bash` with ACI-style prompt hints

Document best-practice affordances in `SKILL.md` and rely on the LLM to self-impose the line budgets and diff constraints.

- **Pros:** No new MCP server; zero implementation cost.
- **Cons:** Measurements consistently show a four-fold lift from constrained-action interfaces over prompt-hinted raw shells (SWE-agent §4). Prompt hints are not enforced; agents under token pressure drop them. No structured `diff` in the response; no audit trail for file edits. Status quo is insufficient for SWE-bench class workloads.
- **Rejected as primary path.** Retained as the degradation route when `skills.aci_shell.enabled = false`.

### Token-level MCTS at the model layer

Apply Monte Carlo Tree Search over token sequences during generation, branching on high-uncertainty tokens.

- **Pros:** Theoretically higher search quality than program-level branching.
- **Cons:** Requires logit access and speculative decoding infrastructure. Agentbox is an inference harness over the Claude API; logit access is not available. Training-time approach; explicitly excluded by PRD-008 §2 principle 1 (inference-only).
- **Rejected.**

### OpenHands sandboxed OS runtime

Adopt the OpenHands platform (paper-T2-openhands) as the execution environment for both ACI and tree-search.

- **Pros:** Richer OS interaction surface; active upstream community.
- **Cons:** L-cost infrastructure rewrite; requires Docker-in-Docker or VM; browsercontainer already covers sandboxed execution; full OS sandbox is a platform pivot. Explicitly rejected in PRD-008 §5 and in the convergence shortlist.
- **Rejected.**

### Separate MCP server for tree-search

Give tree-search its own MCP server rather than implementing it as a skill.

- **Pros:** Cleaner separation; MCP tools are more observable than skill invocations.
- **Cons:** Tree-search has no agent-facing wire contract of its own — it is an orchestration pattern over `sparc:coder` and the kernel MCP. Wrapping it in a third MCP server adds a process and a transport hop without adding a new tool surface. The skill shape (SKILL.md + coordinator invocation) is the correct abstraction for orchestration patterns over existing MCPs.
- **Rejected.**

---

## Rollout

This ADR is deliberately `Proposed`, not `Accepted`. Promotion to `Accepted` is gated on the following ordered conditions:

1. **ADR-018 Phase 1 acceptance gate green.** The kernel MCP must be shipped, stable, and passing all Track A criteria listed in PRD-008 §7 before either surface in this ADR begins implementation. `aci.run_tests` and tree-search branch scoring are both structurally dependent on the kernel.
2. **ADR-019 Phase 1 acceptance gate green.** The ExpeL lesson-extractor must be live, so that ACI session trajectories (marked terminal by `aci.submit`) feed into the lesson store without additional plumbing.
3. **SWE-bench-Lite test environment provisioned.** The PRD-008 §7 Track C acceptance criterion E2 requires a SWE-bench-Lite subset of five problems to be runnable in the dev profile. This environment must exist before the ACI MCP can be validated.

Once the three conditions above are met, this ADR is promoted to `Accepted` and Phase 2 implementation begins. The acceptance criteria for Phase 2 are defined in PRD-008 §7 (criteria E1–E5 for the ACI MCP, criteria F1–F3 for the tree-search skill). This ADR does not duplicate them.

**Phasing within Phase 2:**

| Order | Surface | Dependency |
|---|---|---|
| 2c-i | ACI MCP (`mcp/aci-shell/`) | ADR-018 kernel MCP (hard), ADR-019 ExpeL (soft, for trajectory linkage) |
| 2c-ii | Tree-search skill (`skills/tree-search-coder/`) | ADR-018 kernel MCP (hard), ACI MCP (optional — tree-search can invoke `aci.run_tests` or `kernel.exec` directly) |

**Rollback:** set `skills.aci_shell.enabled = false` and `skills.tree_search_coder.enabled = false` in `agentbox.toml`. The skill-router degrades to `sparc:coder` for code-generation tasks and to direct `Edit`/`Bash` for file-editing tasks. No data migration is required; neither surface writes durable state beyond the rotating JSONL audit files.

---

## Open Questions

1. **`aci.edit_file` atomicity.** Should edits be committed immediately to the working tree (SWE-agent v1 behaviour), or should the agent accumulate a patch set and apply via `aci.submit` (AutoCodeRover behaviour)? Immediate commit is simpler to audit and matches the line-by-line ACI affordance; patch sets allow transactional rollback across multi-file edits. Recommendation for v1: immediate commit. Confirm at ADR promotion.

2. **Tree-search and ACI composition.** When both surfaces are enabled, should a failed assertion during tree-search automatically trigger a new ACI session for the losing branch, or should tree-search operate purely at the kernel level and leave ACI sessions for explicitly invoked bug-fixing tasks? Recommendation: explicit-only — tree-search uses `kernel.exec` directly; ACI sessions are a separate invocation path. Implicit composition introduces unpredictable cost escalation.

3. **`spend_cap_usd` scope.** Is the cap measured per tree-search run, per session, or per day? Per-run is the simplest enforcement boundary and the most predictable for operators. A per-day rollup metric (`agentbox_tree_search_daily_spend_usd` gauge) is useful for alerting but should not be the enforcement boundary in v1. Confirm at ADR promotion.

4. **`aci.run_tests` and kernel session isolation.** Does `aci.run_tests` spawn a separate KernelSession from the agent's main coding session (full isolation: test environment does not see the agent's exploration namespace), or does it reuse the same kernel (state survives into tests)? Recommendation: separate session, via `kernel.reset` before the test invocation. Tests that observe agent exploration state produce unreliable pass/fail signals.

5. **Skill-router collision surface.** The `SKILL.md` for tree-search-coder must include explicit negative-routing guidance distinguishing it from `sparc:coder` (no branching, single attempt), `build-with-quality` (QE pipeline, not candidate selection), and raw `Edit` (no verification loop). This guidance is a hard requirement for Phase 2 acceptance, per PRD-008 §8.

---

## Related Files

- `mcp/aci-shell/` — ACI MCP implementation (Phase 2)
- `skills/tree-search-coder/SKILL.md` — skill definition, algorithm, ICL exemplars (Phase 2)
- `agentbox.toml` — `[skills.aci_shell]` and `[skills.tree_search_coder]` blocks
- `scripts/agentbox-config-validate.js` — E050, E051, E052, W050, W051, W052
- `docs/reference/prd/PRD-008-code-as-harness-integration.md` — §3.2 (ACI wire contract), §3.6 (tree-search), §7 acceptance criteria E1–E5 and F1–F3, §9 observability
- `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` — kernel MCP hard dependency
- `docs/reference/adr/ADR-019-experiential-skill-learning.md` — ExpeL soft dependency for ACI trajectory linkage
- `docs/reference/ddd/DDD-005-code-execution-domain.md` — domain invariants covering kernel session boundaries
- `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md` — middleware binding
- `docs/reference/adr/ADR-013-canonical-uri-grammar.md` — URN minting rules for ACI and tree-search identifiers

---

## References

| Citation | Details |
|---|---|
| SWE-agent (Yang et al.) | arXiv 2405.15793, 2024 — ACI interface; 12.5% pass@1 on SWE-bench-Lite vs ~3% non-interactive baseline |
| ORPS (Qin et al.) | arXiv 2412.15118, 2025 — execution-gated tree-search; +26.9% correctness, +42.2% code efficiency across 5 models and 3 benchmarks |
| Tree-of-Code | arXiv 2412.15305, 2024 — tree-structured code exploration; ~20% accuracy gains with fewer turns |
| PRD-008 | `docs/reference/prd/PRD-008-code-as-harness-integration.md` — §3.2 ACI wire contract, §3.6 tree-search, §4 surface table rows 5–6, §6 Phase 1 Track C, §7 criteria E1–E5 and F1–F3 |
| Convergence shortlist | RuVector namespace `code-harness-survey`, key `convergence-shortlist` — leverage ranks and classification for both surfaces |
