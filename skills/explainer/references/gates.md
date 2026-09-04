# The five gates

Adapted from Repo-Explainer's gates A–E. The headline score is the **lowest** gate; the
bundle is not linked from the docs index until A, B, C and E are green. D is out of scope
unless the owner asks for media.

| Gate | What it checks | Bar | How |
|---|---|---|---|
| **A — Knowledge base** | each question in `kb/questions/{tuned,heldout}.jsonl` answered from the `<repo>-kb` namespace via `memory_search`; retrieval scores on `wantPaths` (0.6 top-1 + 0.4 any-top-k), correctness on `mustContain` coverage minus `forbidden` penalty; per-question = 100·(0.4·M1 + 0.6·M2) | every stage ≥ 95, overall ≥ 98, both sets | `kb/grade.mjs` |
| **B — Comprehension** | a fresh agent (no access to the authoring session) role-plays one audience on the rendered output and must: say what it is; name three concrete uses; recite the first concrete step; confirm each hard concept has a visual | yes on all four, all audiences | manual; record in `gates/ledgers/audit-<audience>.md` |
| **C — Consistency** | every ledger line resolves to a `file:line` that still says it; built / blocked / deferred matches the README status; links resolve; no invented route, flag, status or command | pass / fail | `scripts/check-ledger.sh`, `scripts/check-links.sh`, then a reader |
| **D — Media** | audio / slides teach a true beginner | out of scope by default | — |
| **E — Visuals** | each hard concept has an accurate diagram that renders where the reader reads (GitHub mermaid and the page) | pass / fail | reader |

## Ledger format

One file per document in `gates/ledgers/`, header stating the date and commit, then

```
| # | Claim | Evidence |
| 1 | <the claim as the document states it> | `path:line[-line]` |
```

Add a "Gaps the draft exposed" section when a ledger contradicts another document or
the README: those lines are debug items, hand them to whatever audit is running.

## The fail-below-bar loop

Diagnose each failing question or check into one bucket, apply the smallest fix, re-run:

- **R-fail** (wrong passages retrieved): chunking or a missing primer passage — no rewrite of the document.
- **C-fail** (right passage, fact missing): an ingestion gap — widen the include rule, re-ingest that tree.
- **O-fail** (orientation/synthesis gap): a thin section — edit that section of the document.

Cap at five iterations; if still red, the bar is wrong or the product is undocumented in
that area, and either is a finding worth writing down.
