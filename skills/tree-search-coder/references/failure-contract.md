# Degradation & failure contract

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
