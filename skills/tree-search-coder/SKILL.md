---
name: tree-search-coder
description: >
  Execution-gated branching code generation (ADR-020 Surface 2). Generate N
  candidate solutions (default ≤5) by invoking `sparc:coder` with varied
  temperature/framing, execute each in a fresh `KernelSession` via the
  `code-interpreter` (ADR-018 kernel) MCP, score every branch by assertion-pass
  count, and select the highest-scoring candidate (tie-break on shortest code).
  Slow, N× token cost, mandatory `spend_cap_usd` — NEVER auto-routed; only ever
  invoked explicitly. Use for correctness-critical generation where a single
  attempt is demonstrably insufficient and the measured +26.9% correctness lift
  (ORPS) justifies the cost. NOT for a single generation attempt (use
  `sparc:coder`), depth-on-one QE/TDD (`build-with-quality`), one-trajectory
  stateful loops (`codeact`), or applying a known edit (`Edit`/`aci.edit_file`).
version: 0.1.0
triggers:
  - /tree-search-coder
  - tree search this
  - best of N candidates
  - generate and rank code candidates
  - execution-gated code search
depends_on_mcps:
  - code-interpreter        # ADR-018 kernel MCP — the branch verifier (hard)
optional_mcps:
  - aci-shell               # ADR-020 Surface 1 — tree-search may route tests via aci.run_tests
manifest_gate: "[skills.tree_search_coder] enabled = true"
related_skills:
  - sparc-coder            # tree-search invokes this N times internally; single attempt = use it directly
  - build-with-quality     # QE/TDD pipeline over ONE candidate, not candidate selection
  - codeact                # interactive stateful loop, one trajectory, no branching
  - verification-quality   # truth-score a single result; no exploration
---

# Tree-Search Coder Skill

Execution-gated tree-search over code candidates (ADR-020 Surface 2). This skill
carries no code of its own — it is an **orchestration pattern** that composes
`sparc:coder` (candidate generation) with the `code-interpreter` (ADR-018 kernel)
MCP (candidate verification). It generates a *tree* of alternative programs,
executes each branch, scores by execution outcome, and selects the best.

The verification signal is **Trace-as-Reward (DDD-005)**: a branch's score is its
assertion-pass count observed in a real `ExecutionTrace`, never an LLM opinion
about whether the code "looks correct". No LLM judge sits in the critical path.

Research basis: ORPS (arXiv 2412.15118) reports +26.9% correctness and +42.2%
code efficiency from execution-gated tree-search across 5 models and 3
benchmarks with no fine-tuning; Tree-of-Code (arXiv 2412.15305) reports ~+20%
accuracy with fewer turns.

---

## When to choose

Reach for **tree-search-coder** only when *all* of these hold:

- The task is **correctness-critical** — a subtly-wrong answer is expensive
  (tricky edge cases, numerical boundaries, parser/state-machine logic, an
  algorithm with a known-hard corner).
- A **single attempt is demonstrably insufficient** — you have already tried
  `sparc:coder` once, or you have strong prior that first-shot generation will
  miss an edge case.
- You have **executable assertions or a test suite** that discriminate a correct
  candidate from a plausible-but-wrong one. Tree-search is only as good as the
  signal it scores against; with no discriminating assertions every branch ties.
- The **N× token/latency cost is justified** by the value of getting it right,
  and an explicit `spend_cap_usd` bounds the blast radius.
- You are **explicitly opting in** — a user request, a `/tree-search-coder`
  directive, or a coordinator that has decided this task warrants search.

If any of those is false, this is the wrong tool — see the negative-routing
reference below.

---

## How it works (in brief)

Seven steps: generate N candidates (`sparc:coder`, varied framing) → fresh
kernel per branch (`kernel.reset`) → execute assertions (`kernel.exec`) → score
on assertion-pass count → select highest (tie-break shortest code) → honour the
mandatory `spend_cap_usd` (halt + return best-so-far) → emit the audit
trajectory. Full step contract, manifest gate (`E052`/`W051`/`W052`), and URN/
span schema: **[references/algorithm.md](references/algorithm.md)**.

---

## References (load on demand)

- **[references/algorithm.md](references/algorithm.md)** — the 7-step Surface 2
  algorithm, the `agentbox.toml` manifest gate, validator codes, and the
  URN/observability schema.
- **[references/negative-routing.md](references/negative-routing.md)** — the
  when-NOT-to-choose collision table (`sparc:coder`, `build-with-quality`,
  `codeact`, `Edit`/`aci.edit_file`, `verification-quality`) and the hard
  never-auto-route rule.
- **[references/exemplars.md](references/exemplars.md)** — three worked
  in-context-learning exemplars: best-branch-wins, shortest-code tie-break, and
  the spend-cap halt path, each with kernel tool calls and scoring tables.
- **[references/failure-contract.md](references/failure-contract.md)** — the
  degradation & failure contract: kernel absent/crash, no discriminating
  assertions, and rollback.

### External references

- `docs/archive/adr/ADR-020-aci-mcp-tree-search.md` — Surface 2 decision, the
  7-step algorithm, manifest gates, validator codes E052/W051/W052,
  observability, and the negative-routing requirement (Open Question 5).
- `docs/archive/adr/ADR-018-persistent-code-interpreter-mcp.md` — the kernel
  MCP (`kernel.exec`, `kernel.reset`) that verifies every branch (hard dep).
- `docs/archive/prd/PRD-008-code-as-harness-integration.md` — §3.6 tree-search
  record schema, §7 acceptance criteria F1–F3, §8 router-collision risk row, §9
  observability.
- `skills/codeact/SKILL.md` — the single-trajectory stateful loop this skill
  forks N times over.
- ORPS (arXiv 2412.15118), Tree-of-Code (arXiv 2412.15305) — empirical lift.
