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
  (ORPS) justifies the cost.
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

If any of those is false, this is the wrong tool. See *When NOT to choose*.

---

## The algorithm (ADR-020 §Decision, Surface 2)

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

### Manifest gate

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

---

## When NOT to choose (negative routing)

Tree-search collides with three sibling routes unless the boundary is explicit.
It is the **slow, expensive, opt-in** path; default to a cheaper route and only
escalate to search when the criteria above are met.

| Instead of tree-search-coder, use… | When | Why not tree-search |
|---|---|---|
| **`sparc:coder`** | A single generation attempt is appropriate — most code tasks. | `sparc:coder` is one attempt, no branching, no execution scoring. Tree-search *invokes it N times internally*; if one attempt suffices you are paying N× for nothing. `sparc:coder` is not deprecated by this skill. |
| **`build-with-quality`** | You want a full QE/TDD pipeline over **one** implementation — coverage, defect prediction, quality gates, ADRs. | BWQ verifies and hardens a *single* candidate; it does not generate and *rank a tree* of alternatives. Different axis: BWQ = depth on one; tree-search = breadth then select. |
| **`codeact`** | Multi-step stateful computation/analysis in **one** trajectory — data wrangling, numerical reasoning. | CodeAct is a single plan-execute-reflect loop with persistent state; it never forks competing candidates or scores across branches. |
| **direct `Edit` / `aci.edit_file`** | You know the change and just need to apply it. | No verification loop, no candidate exploration — applying a known edit is not a search problem. Tree-search here is pure overhead. |
| **`verification-quality`** | You have one result and want a truth score / rollback gate. | Scores a single output; there is no branch set to explore or rank. |

**Hard rule:** never auto-route into this skill. Although `enabled = true` in the
live manifest (ADR-020 amendment, 2026-07-05), it is invoked only by an explicit `/tree-search-coder`
directive or user request (ADR-020 Open Question 5; PRD-008 §8). Auto-routing a
task into an N× search is a cost-escalation defect.

---

## In-context-learning exemplars

Three worked exemplars. Each shows the branch set, the fresh-kernel execution of
every candidate, the assertion-pass scoring, and the selection — including the
tie-break and the spend-cap halt paths.

### Exemplar 1 — correctness-critical edge case; best branch wins on pass count

**Task**: Implement `roman_to_int(s)` correctly, including the six subtractive
forms (IV, IX, XL, XC, CD, CM). Discriminating assertions provided.

**Step 1 — generate N=3 candidates via `sparc:coder`** (varied framing).

- **Candidate A** (naive sum — ignores subtraction):
  ```python
  def roman_to_int(s):
      m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
      return sum(m[c] for c in s)
  ```
- **Candidate B** (subtractive lookahead):
  ```python
  def roman_to_int(s):
      m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
      total = 0
      for i, c in enumerate(s):
          if i+1 < len(s) and m[c] < m[s[i+1]]:
              total -= m[c]
          else:
              total += m[c]
      return total
  ```
- **Candidate C** (pair-replace, but drops a case):
  ```python
  def roman_to_int(s):
      s = s.replace('IV','IIII').replace('IX','VIIII').replace('XL','XXXX')
      m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
      return sum(m[c] for c in s)  # missing XC/CD/CM expansions
  ```

**Step 2–3 — fresh kernel per branch, run the shared assertion battery.**

```
Tool: code-interpreter.kernel.reset      # branch A
Tool: code-interpreter.kernel.exec
Args: { "code": "<candidate A>\nchecks=[('III',3),('IV',4),('IX',9),('LVIII',58),('MCMXCIV',1994)]\np=sum(1 for s,v in checks if roman_to_int(s)==v)\nprint(f'passed {p}/{len(checks)}')" }
Trace: { "stdout": "passed 2/5\n", "exception": null, "duration_ms": 3 }
```
```
Tool: code-interpreter.kernel.reset      # branch B
Tool: code-interpreter.kernel.exec
Args: { "code": "<candidate B>\n<same checks>\nprint(f'passed {p}/{len(checks)}')" }
Trace: { "stdout": "passed 5/5\n", "exception": null, "duration_ms": 3 }
```
```
Tool: code-interpreter.kernel.reset      # branch C
Tool: code-interpreter.kernel.exec
Args: { "code": "<candidate C>\n<same checks>\nprint(f'passed {p}/{len(checks)}')" }
Trace: { "stdout": "passed 3/5\n", "exception": null, "duration_ms": 4 }
```

**Step 4–5 — score and select.**

| Branch | Assertion-pass | Exception-free | Lines | Score |
|---|---|---|---|---|
| A | 2/5 | yes | 3 | 2 |
| **B** | **5/5** | **yes** | 8 | **5 ← chosen** |
| C | 3/5 | yes | 4 | 3 |

Candidate B is selected on pass count (5 vs 3 vs 2). No tie-break needed. The
naive branch A that "looked reasonable" is rejected by the trace, not by
inspection — Trace-as-Reward.

**Step 7 — audit:** `{run: "urn:agentbox:tree-search:<scope>:<run-id>",
n_candidates: 3, chosen_id: "B", scores: [2,5,3], halted: false}`.

---

### Exemplar 2 — two correct branches; tie-break on shortest code

**Task**: `is_power_of_two(n)` for `n >= 1`. Assertions cover 1, 2, 3, 1024, 1023.

**Step 1 — N=3 candidates.**

- **Candidate A** (loop divide):
  ```python
  def is_power_of_two(n):
      while n > 1:
          if n % 2: return False
          n //= 2
      return n == 1
  ```
- **Candidate B** (bit trick, one line):
  ```python
  def is_power_of_two(n):
      return n >= 1 and (n & (n - 1)) == 0
  ```
- **Candidate C** (float log — fails on precision):
  ```python
  import math
  def is_power_of_two(n):
      return math.log2(n).is_integer()
  ```

**Step 2–3 — run each in a fresh kernel.**

```
branch A → Trace.stdout "passed 5/5"   exception null   lines 6
branch B → Trace.stdout "passed 5/5"   exception null   lines 2
branch C → Trace.stdout "passed 4/5"   exception null   lines 3   # log2(large 2^k) rounds
```

**Step 4–5 — score, then tie-break.**

| Branch | Assertion-pass | Lines | Note |
|---|---|---|---|
| A | 5/5 | 6 | tie on pass count |
| **B** | **5/5** | **2** | **chosen — shortest of the tied pair** |
| C | 4/5 | 3 | eliminated on pass count |

A and B tie at 5/5. Step 5's tie-break selects the shortest code → **Candidate
B** (2 lines vs 6). Candidate C is eliminated earlier: `math.log2` loses
precision on large powers, so its trace shows 4/5, not a tie.

**Step 7 — audit:** `{n_candidates: 3, chosen_id: "B", scores: [5,5,4],
tiebreak: "shortest_code", halted: false}`.

---

### Exemplar 3 — spend cap trips mid-search; return best-so-far, halted

**Task**: Generate a numerically-stable `softmax(xs)`. Manifest
`max_candidates = 5`, `spend_cap_usd = 0.50`. Each `sparc:coder` candidate plus
its kernel run is metered at ~$0.13.

**Progress.**

```
branch 1  generate+exec  running cost $0.13  → passed 3/4  (overflows on large inputs)
branch 2  generate+exec  running cost $0.27  → passed 4/4  (max-subtract stabilised)
branch 3  generate+exec  running cost $0.41  → passed 3/4  (no max-subtract; exp overflow)
        pre-branch-4 cost check: 0.41 + ~0.13 = 0.54 > spend_cap_usd 0.50  → HALT
```

**Step 6 — halt and return best-so-far.** Branches 4 and 5 are never generated.
The best candidate observed is branch 2 (4/4), so it is selected and returned
with the halt annotation.

**Step 7 — audit:**
```json
{
  "run": "urn:agentbox:tree-search:<scope>:<run-id>",
  "n_candidates": 3,
  "max_candidates": 5,
  "chosen_id": "2",
  "scores": [3, 4, 3],
  "halted": true,
  "reason": "spend_cap",
  "total_cost_usd": 0.41
}
```

The span records `halted=true`. The caller gets a *correct* result (branch 2
passed every assertion) and an honest signal that the search stopped early — not
an unbounded cost overrun. Had no branch passed all assertions, the caller would
receive the highest partial-pass branch plus the same `halted` annotation, and
should treat the result as unverified.

---

## Degradation & failure contract

- **Kernel MCP absent** (`[skills.code_interpreter].enabled = false`): validator
  `E052` blocks enabling this skill. There is no Bash-backed fallback — ADR-020
  §Consequences declares the degraded stateless-Bash approximation explicitly
  **not acceptable** (loses the audit trail and structured scoring). Route to
  `sparc:coder` for a single attempt instead.
- **Kernel crash mid-branch**: that branch's scoring is lost; supervisor
  auto-restart (ADR-018 §Rollout) recovers the kernel. Re-run the affected
  branch or proceed with the remaining candidates.
- **No discriminating assertions**: every branch ties at the same pass count and
  selection collapses to the shortest-code tie-break — a signal that this task
  did not warrant search. Fall back to `sparc:coder`.
- **Rollback**: set `[skills.tree_search_coder].enabled = false`; the router
  degrades to `sparc:coder`. No durable state beyond the rotating audit JSONL.

---

## References (on demand)

- `docs/reference/adr/ADR-020-aci-mcp-tree-search.md` — Surface 2 decision, the
  7-step algorithm, manifest gates, validator codes E052/W051/W052,
  observability, and the negative-routing requirement (Open Question 5).
- `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` — the kernel
  MCP (`kernel.exec`, `kernel.reset`) that verifies every branch (hard dep).
- `docs/reference/prd/PRD-008-code-as-harness-integration.md` — §3.6 tree-search
  record schema, §7 acceptance criteria F1–F3, §8 router-collision risk row, §9
  observability.
- `skills/codeact/SKILL.md` — the single-trajectory stateful loop this skill
  forks N times over.
- ORPS (arXiv 2412.15118), Tree-of-Code (arXiv 2412.15305) — empirical lift.
