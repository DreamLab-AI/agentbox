---
title: Architecture Decision Records
description: Index of the agentbox ADRs (ADR-001..072) with status and the PRD/DDD they tie into.
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
| [014](ADR-014-bidirectional-graph-state-ingress.md) | Bi-directional graph-state ingress for agent reaction | Accepted (Phases 1–3 realised) | [PRD-006](../prd/PRD-006-linked-data-interfaces.md) · [DDD-004](../ddd/DDD-004-linked-data-interchange-domain.md) |
| [015](ADR-015-mcp-ruvector-mandate.md) | Mandate ruvector-postgres for MCP memory backend | Accepted | — |
| [016](ADR-016-license-consolidation.md) | License consolidation — AGPL-3.0-only end-to-end | Accepted | — |
| [017](ADR-017-multi-tenant-did-nostr-pods.md) | Multi-tenant did:nostr pods | Accepted (partially realised 2026-07-03) | [PRD-007](../prd/PRD-007-multi-tenant-federation.md) · [DDD-011](../ddd/DDD-011-multi-tenant-federation-domain.md) |
| [018](ADR-018-persistent-code-interpreter-mcp.md) | Persistent code-interpreter MCP and CodeAct skill | Accepted | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) |
| [019](ADR-019-experiential-skill-learning.md) | Experiential skill learning — distilled lessons | Accepted | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) |
| [020](ADR-020-aci-mcp-tree-search.md) | ACI MCP and execution-gated tree-search | Accepted (S1) / Proposed (S2) 2026-07-03 | [PRD-008](../prd/PRD-008-code-as-harness-integration.md) · [DDD-005](../ddd/DDD-005-code-execution-domain.md) |
| [021](ADR-021-llm-resource-marketplace-kinds.md) | LLM resource marketplace — Nostr kind schema | Accepted | [PRD-009](../prd/PRD-009-llm-resource-marketplace.md) · [DDD-006](../ddd/DDD-006-llm-marketplace-domain.md) |
| [022](ADR-022-runtime-integrity-hardening.md) | Runtime integrity hardening | Accepted | [PRD-010](../prd/PRD-010-runtime-integrity-hardening.md) · [DDD-007](../ddd/DDD-007-runtime-integrity-domain.md) |
| [023](ADR-023-ontology-bridge.md) | VisionClaw ontology bridge via MCP | Accepted (implemented 2026-07-03) | [PRD-011](../prd/PRD-011-ontology-bridge.md) · [DDD-008](../ddd/DDD-008-ontology-bridge-domain.md) |
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
| [034](ADR-034-headroom-rust-crate-integration.md) | Headroom Rust crate integration (content-aware compression) | Accepted (implemented 2026-07-03) | [PRD-016](../prd/PRD-016-context-compression-caching.md) · [DDD-014](../ddd/DDD-014-compression-cache-domain.md) |
| [035](ADR-035-project-tracking-telemetry-and-nostr-kind.md) | Project tracking — port-bound telemetry + kind-30841 | Accepted | [PRD-017](../prd/PRD-017-sovereign-project-tracking.md) · [DDD-015](../ddd/DDD-015-project-tracking-domain.md) |
| [036](ADR-036-ruvector-capability-adoption-and-learning-loop.md) | RuVector capability adoption and learning loop | Implemented | [PRD-018](../prd/PRD-018-ruvector-native-memory-and-learning.md) · [DDD-016](../ddd/DDD-016-memory-learning-domain.md) |
| [037](ADR-037-gap-close-agentbox-decisions.md) | Gap-Close sprint — agentbox slice decisions | Proposed | [PRD-019](../prd/PRD-019-gap-close-agentbox.md) · [DDD-017](../ddd/DDD-017-gap-close-agentbox-context.md) |
| [038](ADR-038-aict-structured-coreutils-mcp.md) | AICT structured-coreutils MCP — trial, do not bake | Proposed | — |
| [039](ADR-039-docbox-backported-surfaces.md) | docBox back-ports — apply-class taxonomy, /v1/system, hash-chained events | Accepted | — |
| [040](ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md) | Learning consumers, model lifecycle, and legacy mining | Implemented | [PRD-020](../prd/PRD-020-ruvector-learning-consumers-and-corpus-uplift.md) · [DDD-018](../ddd/DDD-018-learning-consumers-and-model-lifecycle-domain.md) |
| [041](ADR-041-model-routing-one-policy-many-projections.md) | Model routing — one per-activity Claude/Codex policy, many boot projections | Implemented | [PRD-005](../prd/PRD-005-meta-router-consultants.md) · [ADR-011](ADR-011-consultation-mcps.md) |
| [042](ADR-042-agent-of-empires-interaction-plane.md) | Agent of Empires as the interaction plane — overlay-only adoption | Proposed | [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md) · [DDD-019](../ddd/DDD-019-interaction-plane-domain.md) |
| [043](ADR-043-session-identity-binding.md) | Session identity binding — sovereign mechanisms at the AoE session boundary | Proposed | [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md) · [DDD-019](../ddd/DDD-019-interaction-plane-domain.md) |
| [044](ADR-044-voice-plane-aoe-repoint.md) | Voice-plane repoint — tab0-bridge injection onto the AoE API | Proposed | [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md) · [DDD-019](../ddd/DDD-019-interaction-plane-domain.md) |
| [045](ADR-045-sovereign-ingress-npub-front-door.md) | Sovereign ingress — one npub-gated front door for external control surfaces | Proposed | — |
| [046](ADR-046-semantica-complement.md) | Semantica as a complement to VisionClaw (not a replacement) | Proposed | — |
| [047](ADR-047-semantica-tenant-integration-boundary.md) | Native capability boundary for semantic integrity and provenance | Proposed | — |
| [048](ADR-048-decision-records-as-graph-nodes.md) | Decision records as first-class, Whelk-classifiable graph nodes | Proposed | — |
| [049](ADR-049-bitemporal-facts-and-runtime-provenance.md) | Bi-temporal facts and runtime PROV-O off the reasoned graph | Proposed | — |
| [050](ADR-050-decision-elevation-inverse-corpus-path.md) | Decision elevation — the inverse corpus path | Proposed | — |
| [051](ADR-051-loom-client-and-deferred-distillation.md) | Loom client and deferred distillation | Proposed | — |
| [052](ADR-052-dream-machine-hp-annexe.md) | Dream Machine HP annexe | Proposed | — |
| [053](ADR-053-hex-canonical-pod-naming.md) | Hex-canonical pod naming | Accepted | — |
| [054](ADR-054-ontology-bridge-write-path-findings.md) | Ontology-bridge write-path findings from the terminology live test | Proposed | VisionFlow ADR-006 · logseq ADR-NG-002 |
| [055](ADR-055-dream-cockpit-panel.md) | Dream cockpit panel — surface the nightly dream loop on the operator console | Accepted | — |
| [056](ADR-056-dream-decision-surface.md) | `/dream` decision surface — from inspect to a governed judgment-broker action | Accepted (Phase 1) / Proposed (Phase 2) | — |
| [057](ADR-057-replayable-agent-execution-journal.md) | Replayable agent execution journal and derived projections | Proposed | [PRD-014](../prd/PRD-014-embodied-agent-loop.md) · [DDD-012](../ddd/DDD-012-sovereign-knowledge-elevation-domain.md) |
| [058](ADR-058-lifecycle-scoped-capability-composition.md) | Lifecycle-scoped capability composition over the adapter spine | Proposed | [PRD-001](../prd/PRD-001-capabilities-and-adapters.md) · [DDD-010](../ddd/DDD-010-multi-harness-coordination-domain.md) |
| [059](ADR-059-monotonic-agent-action-policy-pipeline.md) | Monotonic policy pipeline for every agent-initiated action | Proposed | [PRD-003](../prd/PRD-003-runtime-contract-and-container-hardening.md) · [DDD-013](../ddd/DDD-013-hardening-boundary-domain.md) |
| [060](ADR-060-dream-annexe-path-dependencies.md) | Dream annexe — evaluate workspace / path-dependency repos | Accepted | [ADR-052](ADR-052-dream-machine-hp-annexe.md) |
| [061](ADR-061-dream-persist-accept-as-draft-pr.md) | Dream persist ACCEPT as draft PR | Accepted | [ADR-052](ADR-052-dream-machine-hp-annexe.md) |
| [062](ADR-062-metaharness-adoption-posture.md) | MetaHarness adoption posture — two-tier maturity, subprocess-only | Proposed | ruflo#ADR-150/321 |
| [063](ADR-063-enable-ruflo-metaharness-plugin.md) | Enable ruflo-metaharness plugin (boot-apply, read/audit tier) | Proposed | [062](ADR-062-metaharness-adoption-posture.md) |
| [064](ADR-064-bake-metaharness-runtime-binaries.md) | Bake MetaHarness runtime binaries into the Nix closure (rebuild) | Proposed | [063](ADR-063-enable-ruflo-metaharness-plugin.md) |
| [065](ADR-065-dream-darwin-evaluator-liveness.md) | Dream-engine darwin evaluator liveness contract | Proposed | [ADR-052](ADR-052-dream-machine-hp-annexe.md) · metaharness#ADR-099 |
| [066](ADR-066-metaharness-governance-boundaries.md) | MetaHarness governance — proposer-only darwin, human-gated promotion | Proposed | [061](ADR-061-dream-persist-accept-as-draft-pr.md) · metaharness#ADR-322 |
| [067](ADR-067-metaharness-pin-discipline.md) | MetaHarness pin discipline + cross-repo ADR namespacing | Proposed | [064](ADR-064-bake-metaharness-runtime-binaries.md) |
| [068](ADR-068-kernel-tooldispatcher-deferral.md) | Kernel ToolDispatcher deferral (non-goal) | Proposed | [ADR-005](ADR-005-pluggable-adapter-architecture.md) |
| [069](ADR-069-unified-operator-auth-dreamlab-adoption.md) | Unified operator auth — dreamlab-ai auth adoption on the :8444 console | Accepted (implementing) | [043](ADR-043-session-identity-binding.md) · [045](ADR-045-sovereign-ingress-npub-front-door.md) · [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md) |
| [070](ADR-070-self-gc-dream-evidence-governance.md) | Self-GC evidence governance for the dream engine | Accepted | [052](ADR-052-dream-machine-hp-annexe.md) · [061](ADR-061-dream-persist-accept-as-draft-pr.md) · [065](ADR-065-dream-darwin-evaluator-liveness.md) |
| [071](ADR-071-swarm-telemetry-contract-for-xr.md) | Swarm-telemetry contract as consumed by the XR visualiser | Proposed | [051](ADR-051-loom-client-and-deferred-distillation.md) · VisionClaw ADR-140 |
| [072](ADR-072-evaluator-before-schedule.md) | Evaluator-before-schedule for dream-cycle deeps | Proposed | [052](ADR-052-dream-machine-hp-annexe.md) · [065](ADR-065-dream-darwin-evaluator-liveness.md) |

## See also

- [Reference hub](../README.md) — full decision-chain matrix
- [PRDs](../prd/README.md) · [DDDs](../ddd/README.md) · [QE reviews](../qe-reviews/README.md)
