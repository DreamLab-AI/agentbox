---
name: codeact
description: >
  Plan-execute-reflect loop over a persistent Python kernel (the
  `code-interpreter` MCP): write Python, execute, observe the returned trace
  (stdout / exception / last value), then revise. Variables, imports, and
  dataframes survive across every tool call in the session. Use for multi-step
  numerical reasoning, data wrangling, scientific Q&A, hypothesis-test loops,
  or any task where intermediate state must persist between turns and a
  runtime result should drive the next step.
version: 0.1.0
triggers:
  - /codeact
  - write code and run
  - persistent python
  - multi-turn computation
  - data wrangling with state
depends_on_mcps:
  - code-interpreter
related_skills:
  - sparc-code  # SPARC: orchestrator-shaped, plans then writes; CodeAct executes interactively
  - deepseek-reasoning  # math-heavy reasoning without execution
  - pytorch-ml  # heavy GPU scripts (no shared state)
  - build-with-quality  # full TDD swarm -- when assertions + tests matter more than exploration
---

# CodeAct Skill

Interactive, stateful Python execution loop using the `code-interpreter` MCP.
All agent actions are expressed as executable Python. The kernel persists for
the duration of the session; every variable, import, and computed value is
available in subsequent tool calls.

This skill carries no Python itself — it is a routing and in-context-learning
primer. When invoked, it primes the model with the CodeAct Loop protocol and
hands off all execution to the `code-interpreter` MCP via `kernel.exec`.

---

## Quick path — the CodeAct Loop

1. **Write** a small, focused Python block addressing the current sub-goal.
2. **Call** `kernel.exec` with that block.
3. **Read** the returned `ExecutionTrace`: inspect `stdout`, `result`, and
   `exception`. The `ExecutionTrace` is the canonical evidence record; LLM
   opinion about what the code does is not.
4. If `exception` is non-null or `stdout` does not match the expected output,
   **revise** and call `kernel.exec` again. If correct, advance to the next
   sub-goal.
5. All variables from prior `exec` calls remain in the `KernelSession`
   namespace. Reference them freely without re-importing or recomputing.

Continue until the task is complete or a `kernel.reset` is required to clear
corrupted namespace state.

**Trace-as-Reward (DDD-005)**: the `ExecutionTrace` is ground truth. A clean
exit with the expected `stdout`/`result` verifies the step — no LLM judge is in
the critical path.

The `code-interpreter` MCP exposes six tools on the `KernelSession`:
`kernel.exec` (the loop workhorse), plus `kernel.list_vars`, `kernel.inspect`,
`kernel.reset`, `kernel.interrupt`, and `kernel.install_pkg` for debugging and
introspection. See `references/operations.md` for their session semantics.

Worked tool-call syntax (three exemplars showing state persistence across calls):
see `references/exemplars.md`.

---

## When to use

- Multiple sequential computation steps that depend on each other's results
  (e.g. load data, filter, aggregate, visualise).
- Intermediate state (DataFrames, model objects, parsed structures) would be
  expensive or awkward to re-derive from scratch on every tool call.
- The agent needs to observe a runtime result — an exception traceback, a
  printed value, an assertion outcome — and revise based on that observation.
- Numerical reasoning, data wrangling, hypothesis testing, or scientific
  computation where the Python interpreter is the source of truth.

## When NOT to use

| Instead of CodeAct, use… | When |
|---|---|
| **Bash** | One-shot execution, no state needed — no kernel overhead. |
| **`sparc-code`** | Single-file code generation without execution; plan-then-write, stateless. |
| **`deepseek-reasoning`** | Pure symbolic / mathematical reasoning with no data to load. |
| **`pytorch-ml`** | Heavy GPU training or multi-file ML scripts — subprocess/script mode; the kernel MCP is CPU-only in v1. |
| **`build-with-quality`** | Full TDD pipeline with assertion gates, coverage, defect prediction — a QE swarm, not exploration. |

Reach back for **codeact** whenever the task is multi-step *with* state across
turns, or data analysis over a single dataset where state should persist so you
revise without reloading.

---

## References (on demand)

- `references/exemplars.md` — three in-context-learning exemplars with exact
  `kernel.exec` tool-call syntax and trace outputs, demonstrating
  `KernelSession` state persistence.
- `references/operations.md` — degradation / fail-closed contract, the
  `agentbox.toml` manifest gate, kernel session semantics (reset / interrupt /
  inspect, cold-start, serialisation across sessions), identity + ecosystem URN
  tagging, and composition with `expel-lesson-extractor`,
  `voyager-skill-library`, and `tree-search-coder`.
- `references/empirical-priors.md` — benchmark lifts, token-efficiency data,
  RSS/cost accounting for swarm sizing, and the ADR/DDD/PRD + arxiv citation
  list.
