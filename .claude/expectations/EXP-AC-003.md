---
id: EXP-AC-003
parent_spec: PRD-augmentation-conditions FR3
linked_adrs: [ADR-2011]
priority: critical
regression_critical: true
evidence_category: executable
status: accepted
authored_by: pair
---

## Expectation: The effective tier derives from operator task properties and a request can only tighten it

`nostr-bbs-core` exposes `TaskProperties` and `effective_tier(panel, request, declared) -> RiskTier`. For every combination: `reversibility == Irreversible` or `stakes == Critical` yields at least `High`; `verifiability == Opaque` yields at least `Medium` and `is_member_suppressed` is false; otherwise the result is `max(panel_default_tier, declared)`. `TaskProperties::merge(panel, request)` never returns a property looser than `panel` (property test over all 27×27 combinations). The relay stores the effective tier on `broker_cases`; an unlabelled 31402 projects with the NIP-11 advertised default tier; a case with effective `High`/`Critical` cannot reach `Decided` through any non-31403 path. agentbox `governance_request_action` for a `zero-tolerance` action class emits `tp-reversibility=irreversible` and the authority gate stamps the triple on its 31402.

### In scope
- Pure function table and property test
- Relay projection of effective tier and default folding
- agentbox derivation from `authority_class`
- Legacy panels/requests without tags parse to panel default / advertised default

### Out of scope (intentionally)
- UI for declaring properties on panel publish (tracked as follow-on; tool prompt is in scope)

### Counter-examples (must NOT happen)
- A request tag lowering `Irreversible` to `Reversible`
- A `Critical`-stakes request suppressed from the member surface
- Any consumer reading `risk_tier` for suppression after the change
