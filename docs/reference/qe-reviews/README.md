---
title: QE reviews
description: Quality-engineering traceability and re-verification gates for the agentbox specification corpus.
---

# QE reviews

> [Agentbox Docs](../../README.md) · [Reference](../README.md) · QE reviews

QE reviews are merge gates over the specification corpus. Each one checks
cross-document traceability — that every PRD acceptance criterion maps to an ADR
decision and a DDD invariant, and that no orphaned references survive. A review
that returns BLOCK or PASS-WITH-CONDITIONS records the defects and the conditions
under which the chain may merge.

| # | Title | Date | Scope | Verdict |
|---|-------|------|-------|---------|
| [001](QE-001-code-as-harness-traceability-review.md) | PRD-008 / ADR-018 / ADR-019 / DDD-005 traceability review | 2026-05-20 | Code-as-Harness chain (v1) | BLOCK — 5 blockers, 5 majors, 4 minors |
| [002](QE-002-code-as-harness-reverification.md) | Re-verification of QE-001 defects (adds ADR-020) | 2026-05-20 | 14 defects from QE-001 + regression | PASS-WITH-CONDITIONS — 10 fixed, 2 partial, 2 unfixed |

Both reviews gate the **Code-as-Harness** chain:
[PRD-008](../prd/PRD-008-code-as-harness-integration.md) ·
[ADR-018](../adr/ADR-018-persistent-code-interpreter-mcp.md),
[ADR-019](../adr/ADR-019-experiential-skill-learning.md),
[ADR-020](../adr/ADR-020-aci-mcp-tree-search.md) ·
[DDD-005](../ddd/DDD-005-code-execution-domain.md).
QE-001 flagged the then-missing ADR-020 as a blocker; QE-002 re-verified the
fix-up pass once ADR-020 landed.

## See also

- [Reference hub](../README.md) — full decision-chain matrix
- [ADRs](../adr/README.md) · [PRDs](../prd/README.md) · [DDDs](../ddd/README.md)
