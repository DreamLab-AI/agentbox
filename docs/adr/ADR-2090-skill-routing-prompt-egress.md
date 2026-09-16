---
id: ADR-2090
title: Skill-routing prompts may egress to the judge; per-project gates are deferred, not waived
date: 2026-09-16
decision_status: accepted
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the first project whose content must not reach the judge, or any proposal to widen this beyond skill routing
repo: agentbox
---

# ADR-2090 — Skill-routing prompts may egress to the judge; per-project gates are deferred, not waived

## Context

ADR-2089 established measured skill discovery using a third-party judgement API (TypeSafe
System One / Jev) offline, against this repo's own public skill descriptions. Routing *live*
was blocked on one thing: the state of a routing call is the user's own turn text, and it
cannot be redacted and still routed on. Measured economics (2026-09-16): a full-fleet route
costs **$0.000662** (15.8k input tokens at $0.042/MTok, output free) against **$0.001446 per
turn** for the 20 always-loaded descriptions in Opus cache reads, and **$0.0823** for one
`/route`. Cost argues for the router; only egress argued against it.

## Decision

**Operator decision: for skill routing, the routing prompt may leave the network.** The
selection of which skill handles a request is not treated as sensitive content, and a live
router may send the user's turn text to the judge.

**Scope is exactly skill routing.** This decision does not widen the boundary for any other
use case. The must-not-leave classes in
`skills/system-one/references/data-boundary.md` — the owner's personal mail, the private
context portfolio, private knowledge-graph instance data, credentials and key material,
client content under confidentiality — remain closed for every purpose other than choosing a
skill, and closed to every consumer other than the router.

**Per-project gates are deferred, not waived.** Tightening is expected to arrive
project-by-project as projects with content that must not reach the judge appear. Until then
there is no per-project gate, and this ADR is the record that its absence is a known, accepted
state rather than an oversight.

## Consequences

- A live skill router is unblocked. It is cheaper than the status quo, covers all 127 skills
  rather than a curated 20, and returns ~2,900 tokens per turn to the context window.
- **A routing call carries whatever the user typed**, including, on some turns, content from a
  must-not-leave class. That is the accepted cost of this decision, not an edge case: the turns
  where routing matters most are the ones most likely to carry real content.
- The first project that cannot accept this needs a gate before it runs, and the router needs a
  bypass path for it. Neither exists yet. That is the debt this ADR records.
- Nothing about the offline measurement rig changes; it never sent a user turn and still does
  not.
- Two engineering consequences carry over from ADR-2089 and are unaffected by this decision:
  a sole-dispatch router must fail **open** to existing description matching on 429/529 (the
  fallback is the normal path when the service is slow, not an error branch), and **confidence
  is not a safety net** — a wrong pick was measured at 0.94, so no low-confidence-escalates
  rule may be relied on without local threshold measurement.

## Verification

Not implemented. `implementation_status: none` is the honest state: this ADR records a
decision that unblocks work, not work that has been done. No live router exists; skill
selection is still the always-loaded manifest plus `/route`. When a router is built, it gets
its own record and this one gains a `superseded_by` or an amendment.
