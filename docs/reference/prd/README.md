---
title: Product Requirement Documents
description: Index of the 22 agentbox PRDs (PRD-001..022) plus PRD-REMEDIATION-001, with status and decision chains.
---

# Product Requirement Documents

> [Agentbox Docs](../../README.md) · [Reference](../README.md) · PRD

Each PRD states a capability, its scope, and its acceptance criteria. The *Chain*
column links the ADRs that record the decisions and the DDD that models the
bounded context. PRD-REMEDIATION-001 is the relocated remediation programme that
shipped the default-secure posture.

| # | Title | Status | Chain |
|---|-------|--------|-------|
| [001](PRD-001-capabilities-and-adapters.md) | Agentbox capabilities and adapter architecture | Accepted | [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md), [ADR-031](../adr/ADR-031-adapter-contract-enforcement.md) |
| [002](PRD-002-immutable-runtime-bootstrap.md) | Immutable runtime bootstrap | Draft v2 | [ADR-006](../adr/ADR-006-immutable-runtime-bootstrap.md) · [DDD-001](../ddd/DDD-001-immutable-bootstrap-domain.md) |
| [003](PRD-003-runtime-contract-and-container-hardening.md) | Runtime contract and container hardening | Draft v2 | [ADR-007](../adr/ADR-007-runtime-contract-and-container-hardening.md) · [DDD-002](../ddd/DDD-002-runtime-contract-domain.md) |
| [004](PRD-004-external-agent-messaging.md) | External agent messaging and sovereign relay surface | Draft v1 | [ADR-008](../adr/ADR-008-privacy-filter-routing.md), [ADR-009](../adr/ADR-009-embedded-nostr-relay.md), [ADR-010](../adr/ADR-010-rust-solid-pod-adoption.md) · [DDD-003](../ddd/DDD-003-sovereign-messaging-domain.md) |
| [005](PRD-005-meta-router-consultants.md) | Meta-router and consultant tier | Draft v1 | [ADR-011](../adr/ADR-011-consultation-mcps.md) |
| [006](PRD-006-linked-data-interfaces.md) | Linked-data interfaces and JSON-LD compatible surfaces | Draft v1 | [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md), [ADR-014](../adr/ADR-014-bidirectional-graph-state-ingress.md) · [DDD-004](../ddd/DDD-004-linked-data-interchange-domain.md) |
| [007](PRD-007-multi-tenant-federation.md) | Multi-tenant federation | Proposed | [ADR-017](../adr/ADR-017-multi-tenant-did-nostr-pods.md) · [DDD-011](../ddd/DDD-011-multi-tenant-federation-domain.md) |
| [008](PRD-008-code-as-harness-integration.md) | Code-as-Harness integration | Draft v1 (Phase 2 enabled 2026-07-05) | [ADR-018](../adr/ADR-018-persistent-code-interpreter-mcp.md), [ADR-019](../adr/ADR-019-experiential-skill-learning.md), [ADR-020](../adr/ADR-020-aci-mcp-tree-search.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) · [QE-001](../qe-reviews/QE-001-code-as-harness-traceability-review.md), [QE-002](../qe-reviews/QE-002-code-as-harness-reverification.md) |
| [009](PRD-009-llm-resource-marketplace.md) | LLM resource marketplace | Draft v1 | [ADR-021](../adr/ADR-021-llm-resource-marketplace-kinds.md) · [DDD-006](../ddd/DDD-006-llm-marketplace-domain.md) |
| [010](PRD-010-runtime-integrity-hardening.md) | Runtime integrity hardening | Draft v1 | [ADR-022](../adr/ADR-022-runtime-integrity-hardening.md) · [DDD-007](../ddd/DDD-007-runtime-integrity-domain.md) |
| [011](PRD-011-ontology-bridge.md) | VisionClaw ontology bridge | Proposed | [ADR-023](../adr/ADR-023-ontology-bridge.md) · [DDD-008](../ddd/DDD-008-ontology-bridge-domain.md) |
| [012](PRD-012-setup-dashboard.md) | Agentbox setup wizard and operations dashboard | Implemented | [ADR-024](../adr/ADR-024-setup-dashboard.md) · [DDD-009](../ddd/DDD-009-setup-dashboard-domain.md) |
| [013](PRD-013-multi-harness-tmux-architecture.md) | Multi-harness tmux architecture and documentation revamp | Draft v1 | [ADR-025](../adr/ADR-025-multi-harness-tmux-architecture.md) · [DDD-010](../ddd/DDD-010-multi-harness-coordination-domain.md) |
| [014](PRD-014-embodied-agent-loop.md) | Embodied agent loop — voice-to-ontology gap closure | In progress (Tier A done; Tier B WS5 Stage 1–3a) | [ADR-026](../adr/ADR-026-cross-substrate-agent-loop-seams.md), [ADR-028](../adr/ADR-028-per-user-agent-fabric.md), [ADR-029](../adr/ADR-029-session-mirror-live-egress.md) · [DDD-012](../ddd/DDD-012-sovereign-knowledge-elevation-domain.md) |
| [015](PRD-015-consumer-broadcast-economy.md) | Consumer & broadcast economy surfaces | Draft v1.2 | [ADR-021](../adr/ADR-021-llm-resource-marketplace-kinds.md), [ADR-032](../adr/ADR-032-402-scheme-grammar.md), [ADR-033](../adr/ADR-033-did-nostr-multikey-convergence.md) · [DDD-006](../ddd/DDD-006-llm-marketplace-domain.md) |
| [016](PRD-016-context-compression-caching.md) | Context compression & caching (Headroom integration) | Draft v1.0 | [ADR-034](../adr/ADR-034-headroom-rust-crate-integration.md) · [DDD-014](../ddd/DDD-014-compression-cache-domain.md) |
| [017](PRD-017-sovereign-project-tracking.md) | Sovereign project tracking | Draft v1 (enabled in production 2026-07-05) | [ADR-035](../adr/ADR-035-project-tracking-telemetry-and-nostr-kind.md) · [DDD-015](../ddd/DDD-015-project-tracking-domain.md) |
| [018](PRD-018-ruvector-native-memory-and-learning.md) | RuVector-native memory and learning | Draft v1 (Phases 0–2 shipped 2026-07-05) | [ADR-036](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md) · [DDD-016](../ddd/DDD-016-memory-learning-domain.md) |
| [019](PRD-019-gap-close-agentbox.md) | Gap-Close Sprint — agentbox slice | Draft v1 (WorkPackageMinted) | [ADR-037](../adr/ADR-037-gap-close-agentbox-decisions.md) · [DDD-017](../ddd/DDD-017-gap-close-agentbox-context.md) |
| [020](PRD-020-ruvector-learning-consumers-and-corpus-uplift.md) | RuVector learning consumers and corpus uplift | Draft v1 (W-A–W-E landed 2026-07-21/22) | [ADR-040](../adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md) · [DDD-018](../ddd/DDD-018-learning-consumers-and-model-lifecycle-domain.md) |
| [021](PRD-021-interaction-surface-consolidation.md) | Interaction-surface consolidation around Agent of Empires | Proposed | [ADR-042](../adr/ADR-042-agent-of-empires-interaction-plane.md), [ADR-043](../adr/ADR-043-session-identity-binding.md), [ADR-044](../adr/ADR-044-voice-plane-aoe-repoint.md), [ADR-045](../adr/ADR-045-sovereign-ingress-npub-front-door.md), [ADR-069](../adr/ADR-069-unified-operator-auth-dreamlab-adoption.md) · [DDD-019](../ddd/DDD-019-interaction-plane-domain.md) |
| [022](PRD-022-semantic-integrity-provenance-decisions.md) | Semantic integrity, provenance and decision intelligence | Draft v1 | [ADR-047](../adr/ADR-047-semantica-tenant-integration-boundary.md), [ADR-048](../adr/ADR-048-decision-records-as-graph-nodes.md), [ADR-049](../adr/ADR-049-bitemporal-facts-and-runtime-provenance.md), [ADR-050](../adr/ADR-050-decision-elevation-inverse-corpus-path.md) · [DDD-020](../ddd/DDD-020-semantic-integrity-provenance-domain.md) |
| [REMEDIATION-001](PRD-REMEDIATION-001.md) | Default-secure posture remediation | Shipped (Phase 0–4) | [ADR-027](../adr/ADR-027-default-secure-posture.md) · [DDD-013](../ddd/DDD-013-hardening-boundary-domain.md) |

## See also

- [Reference hub](../README.md) — full decision-chain matrix
- [ADRs](../adr/README.md) · [DDDs](../ddd/README.md) · [QE reviews](../qe-reviews/README.md)
