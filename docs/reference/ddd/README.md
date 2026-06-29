---
title: Domain-Driven Design models
description: Index of the 15 agentbox DDD bounded-context models (DDD-001..015) with status and decision chains.
---

# Domain-Driven Design models

> [Agentbox Docs](../../README.md) · [Reference](../README.md) · DDD

Each DDD models one bounded context: its ubiquitous language, aggregates,
entities, value objects, and invariants. The *Chain* column links the PRD that
drove the context and the ADRs whose decisions it realises.

| # | Title | Status | Chain |
|---|-------|--------|-------|
| [001](DDD-001-immutable-bootstrap-domain.md) | Immutable Bootstrap Domain | Accepted | [PRD-002](../prd/PRD-002-immutable-runtime-bootstrap.md) · [ADR-006](../adr/ADR-006-immutable-runtime-bootstrap.md) |
| [002](DDD-002-runtime-contract-domain.md) | Runtime Contract Domain | Accepted | [PRD-003](../prd/PRD-003-runtime-contract-and-container-hardening.md) · [ADR-007](../adr/ADR-007-runtime-contract-and-container-hardening.md) |
| [003](DDD-003-sovereign-messaging-domain.md) | Sovereign Messaging Domain | Accepted | [PRD-004](../prd/PRD-004-external-agent-messaging.md) · [ADR-008](../adr/ADR-008-privacy-filter-routing.md), [ADR-009](../adr/ADR-009-embedded-nostr-relay.md), [ADR-010](../adr/ADR-010-rust-solid-pod-adoption.md) |
| [004](DDD-004-linked-data-interchange-domain.md) | Linked-Data Interchange Domain | Accepted | [PRD-006](../prd/PRD-006-linked-data-interfaces.md) · [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md), [ADR-014](../adr/ADR-014-bidirectional-graph-state-ingress.md) |
| [005](DDD-005-code-execution-domain.md) | Code Execution and Experiential Learning Domain | Draft | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [ADR-018](../adr/ADR-018-persistent-code-interpreter-mcp.md), [ADR-019](../adr/ADR-019-experiential-skill-learning.md), [ADR-020](../adr/ADR-020-aci-mcp-tree-search.md) · [QE-001](../qe-reviews/QE-001-code-as-harness-traceability-review.md) |
| [006](DDD-006-llm-marketplace-domain.md) | LLM Resource Marketplace Domain | Draft | [PRD-009](../prd/PRD-009-llm-resource-marketplace.md) · [ADR-021](../adr/ADR-021-llm-resource-marketplace-kinds.md) |
| [007](DDD-007-runtime-integrity-domain.md) | Runtime Integrity Domain | Accepted | [PRD-010](../prd/PRD-010-runtime-integrity-hardening.md) · [ADR-022](../adr/ADR-022-runtime-integrity-hardening.md) |
| [008](DDD-008-ontology-bridge-domain.md) | Ontology Bridge Domain Model | Proposed | [PRD-011](../prd/PRD-011-ontology-bridge.md) · [ADR-023](../adr/ADR-023-ontology-bridge.md) |
| [009](DDD-009-setup-dashboard-domain.md) | Setup Wizard and Operations Dashboard Domain | Draft | [PRD-012](../prd/PRD-012-setup-dashboard.md) · [ADR-024](../adr/ADR-024-setup-dashboard.md) |
| [010](DDD-010-multi-harness-coordination-domain.md) | Multi-Harness Coordination Domain | Draft | [PRD-013](../prd/PRD-013-multi-harness-tmux-architecture.md) · [ADR-025](../adr/ADR-025-multi-harness-tmux-architecture.md) |
| [011](DDD-011-multi-tenant-federation-domain.md) | Multi-Tenant Federation Domain | Draft | [PRD-007](../prd/PRD-007-multi-tenant-federation.md) · [ADR-017](../adr/ADR-017-multi-tenant-did-nostr-pods.md) |
| [012](DDD-012-sovereign-knowledge-elevation-domain.md) | Sovereign Knowledge Elevation Domain | Proposed | [PRD-014](../prd/PRD-014-embodied-agent-loop.md) · [ADR-026](../adr/ADR-026-cross-substrate-agent-loop-seams.md) |
| [013](DDD-013-hardening-boundary-domain.md) | Hardening Boundary Domain | Accepted | [PRD-REMEDIATION-001](../prd/PRD-REMEDIATION-001.md) · [ADR-027](../adr/ADR-027-default-secure-posture.md) |
| [014](DDD-014-compression-cache-domain.md) | Compression & Cache Domain | Proposed | [PRD-016](../prd/PRD-016-context-compression-caching.md) · [ADR-034](../adr/ADR-034-headroom-rust-crate-integration.md) |
| [015](DDD-015-project-tracking-domain.md) | Project Tracking Domain | Accepted | [PRD-017](../prd/PRD-017-sovereign-project-tracking.md) · [ADR-035](../adr/ADR-035-project-tracking-telemetry-and-nostr-kind.md) |

## See also

- [Reference hub](../README.md) — full decision-chain matrix
- [ADRs](../adr/README.md) · [PRDs](../prd/README.md) · [QE reviews](../qe-reviews/README.md)
