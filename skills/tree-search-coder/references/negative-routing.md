# When NOT to choose (negative routing)

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
