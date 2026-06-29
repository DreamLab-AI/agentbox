---
title: Architecture Decision Records
description: Index of all 35 agentbox ADRs (ADR-001..035) with status and the PRD/DDD they tie into.
---

# Architecture Decision Records

> [Agentbox Docs](../../README.md) · [Reference](../README.md) · ADR

Each ADR records one structural decision, its context, and its consequences.
Older records use `**Status:**` markdown; ADR-023 onward carry YAML frontmatter
(`status:`). The *Chain* column links the requirement (PRD) and domain model
(DDD) each decision serves.

| # | Title | Status | Chain |
|---|-------|--------|-------|
| [001](ADR-001-nixos-flakes.md) | Nix Flake Build Architecture | Accepted | — |
| [002](ADR-002-ruvector-standalone.md) | RuVector as embedded search layer | Accepted | [PRD-001](../prd/PRD-001-capabilities-and-adapters.md) |
| [003](ADR-003-guidance-control-plane.md) | Guidance Control Plane integration | Accepted | — |
| [004](ADR-004-upstream-sync.md) | Upstream sync boundaries | Accepted | — |
| [005](ADR-005-pluggable-adapter-architecture.md) | Pluggable adapter architecture for durable state | Accepted | [PRD-001](../prd/PRD-001-capabilities-and-adapters.md) |
| [006](ADR-006-immutable-runtime-bootstrap.md) | Immutable runtime bootstrap | Accepted | [PRD-002](../prd/PRD-002-immutable-runtime-bootstrap.md) · [DDD-001](../ddd/DDD-001-immutable-bootstrap-domain.md) |
| [007](ADR-007-runtime-contract-and-container-hardening.md) | Runtime contract and container hardening | Accepted | [PRD-003](../prd/PRD-003-runtime-contract-and-container-hardening.md) · [DDD-002](../ddd/DDD-002-runtime-contract-domain.md) |
| [008](ADR-008-privacy-filter-routing.md) | Privacy filter routing layer | Accepted | [PRD-004](../prd/PRD-004-external-agent-messaging.md) · [DDD-003](../ddd/DDD-003-sovereign-messaging-domain.md) |
| [009](ADR-009-embedded-nostr-relay.md) | Embedded Nostr relay and pod-inbox bridge | Accepted | [PRD-004](../prd/PRD-004-external-agent-messaging.md) · [DDD-003](../ddd/DDD-003-sovereign-messaging-domain.md) |
| [010](ADR-010-rust-solid-pod-adoption.md) | solid-pod-rs as first-class pod server | Accepted | [PRD-004](../prd/PRD-004-external-agent-messaging.md) · [DDD-003](../ddd/DDD-003-sovereign-messaging-domain.md) |
| [011](ADR-011-consultation-mcps.md) | Consultation MCP servers as the meta-router | Accepted | [PRD-005](../prd/PRD-005-meta-router-consultants.md) |
| [012](ADR-012-jsonld-federation-grammar.md) | JSON-LD 1.1 as the federation interchange grammar | Accepted | [PRD-006](../prd/PRD-006-linked-data-interfaces.md) · [DDD-004](../ddd/DDD-004-linked-data-interchange-domain.md) |
| [013](ADR-013-canonical-uri-grammar.md) | Canonical URI grammar and resolver | Accepted | [PRD-006](../prd/PRD-006-linked-data-interfaces.md) · [DDD-004](../ddd/DDD-004-linked-data-interchange-domain.md) |
| [014](ADR-014-bidirectional-graph-state-ingress.md) | Bi-directional graph-state ingress for agent reaction | Accepted | [PRD-006](../prd/PRD-006-linked-data-interfaces.md) · [DDD-004](../ddd/DDD-004-linked-data-interchange-domain.md) |
| [015](ADR-015-mcp-ruvector-mandate.md) | Mandate ruvector-postgres for MCP memory backend | Accepted | — |
| [016](ADR-016-license-consolidation.md) | License consolidation — AGPL-3.0-only end-to-end | Accepted | — |
| [017](ADR-017-multi-tenant-did-nostr-pods.md) | Multi-tenant did:nostr pods | Proposed | [PRD-007](../prd/PRD-007-multi-tenant-federation.md) · [DDD-011](../ddd/DDD-011-multi-tenant-federation-domain.md) |
| [018](ADR-018-persistent-code-interpreter-mcp.md) | Persistent code-interpreter MCP and CodeAct skill | Accepted | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) |
| [019](ADR-019-experiential-skill-learning.md) | Experiential skill learning — distilled lessons | Accepted | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) |
| [020](ADR-020-aci-mcp-tree-search.md) | ACI MCP and execution-gated tree-search | Proposed | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) |
| [021](ADR-021-llm-resource-marketplace-kinds.md) | LLM resource marketplace — Nostr kind schema | Accepted | [PRD-009](../prd/PRD-009-llm-resource-marketplace.md) · [DDD-006](../ddd/DDD-006-llm-marketplace-domain.md) |
| [022](ADR-022-runtime-integrity-hardening.md) | Runtime integrity hardening | Accepted | [PRD-010](../prd/PRD-010-runtime-integrity-hardening.md) · [DDD-007](../ddd/DDD-007-runtime-integrity-domain.md) |
| [023](ADR-023-ontology-bridge.md) | VisionClaw ontology bridge via MCP | Proposed | [PRD-011](../prd/PRD-011-ontology-bridge.md) · [DDD-008](../ddd/DDD-008-ontology-bridge-domain.md) |
| [024](ADR-024-setup-dashboard.md) | Setup wizard and operations dashboard architecture | Accepted | [PRD-012](../prd/PRD-012-setup-dashboard.md) · [DDD-009](../ddd/DDD-009-setup-dashboard-domain.md) |
| [025](ADR-025-multi-harness-tmux-architecture.md) | Multi-harness tmux architecture | Accepted | [PRD-013](../prd/PRD-013-multi-harness-tmux-architecture.md) · [DDD-010](../ddd/DDD-010-multi-harness-coordination-domain.md) |
| [026](ADR-026-cross-substrate-agent-loop-seams.md) | Cross-substrate agent-loop seams | Accepted (partial) | [PRD-014](../prd/PRD-014-embodied-agent-loop.md) · [DDD-012](../ddd/DDD-012-sovereign-knowledge-elevation-domain.md) |
| [027](ADR-027-default-secure-posture.md) | Default-secure posture and runtime-isolation roadmap | Accepted (S1–S3) | [PRD-REMEDIATION-001](../prd/PRD-REMEDIATION-001.md) · [DDD-013](../ddd/DDD-013-hardening-boundary-domain.md) |
| [028](ADR-028-per-user-agent-fabric.md) | Per-user agent fabric | Accepted | [PRD-014](../prd/PRD-014-embodied-agent-loop.md) |
| [029](ADR-029-session-mirror-live-egress.md) | Session-mirror live egress (per-turn NIP-59 self-DM) | Accepted | [PRD-014](../prd/PRD-014-embodied-agent-loop.md) |
| [030](ADR-030-sovereign-mesh-manifest-boundary.md) | Sovereign-mesh manifest boundary | Accepted | — |
| [031](ADR-031-adapter-contract-enforcement.md) | Adapter contract enforcement — the merge gate is executable | Accepted | [PRD-001](../prd/PRD-001-capabilities-and-adapters.md) |
| [032](ADR-032-402-scheme-grammar.md) | The 402 payment challenge & scheme-detection grammar | Accepted | [PRD-015](../prd/PRD-015-consumer-broadcast-economy.md) |
| [033](ADR-033-did-nostr-multikey-convergence.md) | did:nostr Multikey convergence | Accepted | [PRD-015](../prd/PRD-015-consumer-broadcast-economy.md) |
| [034](ADR-034-headroom-rust-crate-integration.md) | Headroom Rust crate integration (content-aware compression) | Proposed | [PRD-016](../prd/PRD-016-context-compression-caching.md) · [DDD-014](../ddd/DDD-014-compression-cache-domain.md) |
| [035](ADR-035-project-tracking-telemetry-and-nostr-kind.md) | Project tracking — port-bound telemetry + kind-30841 | Accepted | [PRD-017](../prd/PRD-017-sovereign-project-tracking.md) · [DDD-015](../ddd/DDD-015-project-tracking-domain.md) |

## See also

- [Reference hub](../README.md) — full decision-chain matrix
- [PRDs](../prd/README.md) · [DDDs](../ddd/README.md) · [QE reviews](../qe-reviews/README.md)
