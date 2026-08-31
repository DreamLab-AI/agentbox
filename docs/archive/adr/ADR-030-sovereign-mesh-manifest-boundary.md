---
id: ADR-030
title: Sovereign-mesh manifest boundary (the [sovereign_mesh] subsystem gate)
status: accepted
date: 2026-06-11
type: architecture
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-009, ADR-010, ADR-017, ADR-027]
related: [ADR-028, ADR-029, PRD-004, PRD-007]
review_trigger: a key is added to or removed from the [sovereign_mesh] block; a new sub-table is added under [sovereign_mesh]; the mobile_bridge external hop changes endpoint or posture; or the gate-vs-env-override semantics change
"@context": https://schema.org
"@type": TechArticle
---

# ADR-030 — Sovereign-mesh manifest boundary

**Related:** ADR-005 (Pluggable adapter architecture — cross-cutting middleware rule), ADR-008 (Privacy filter routing), ADR-009 (Embedded Nostr relay), ADR-010 (solid-pod-rs), ADR-017 (Multi-tenant did:nostr pods), ADR-027 (Default-secure posture), ADR-028 (Per-User Agent Fabric), ADR-029 (Session-mirror live egress), PRD-004 (External agent messaging), PRD-007 (Multi-tenant federation)

## TL;DR for newcomers
*Skip if you already know what `[sovereign_mesh]` gates and where the box phones out.*

`[sovereign_mesh]` in `agentbox.toml` is **one manifest-gated subsystem** that umbrellas every Nostr-identity-and-relay feature: the embedded relay, the operator identity, per-user agents, the shared JunkieJarvis forum agent, the mobile bridge (phone egress), git-versioned pods, and multi-tenant pods. This ADR records the umbrella as a single subsystem with a single gate convention — **default off, env var remains the runtime override** (the just-landed R7 fix) — and pins the **one external data hop** the whole mesh makes: the mobile-bridge Z.AI summarisation. Everything else in the mesh stays on-box.

**If you remember only one thing:** `[sovereign_mesh]` is one subsystem behind one manifest gate; every feature in it is off by default; an env var can still flip a feature on at runtime; and the mesh phones out to exactly one external endpoint — the mobile-bridge digest summarisation — which is itself off by default and fail-open.

For the deep version, keep reading.

## Context

The `[sovereign_mesh]` block grew organically across PRD-004 (external agent messaging, ADR-009), ADR-010 (solid-pod-rs), ADR-017/PRD-007 (multi-tenant pods), ADR-028 (per-user agents), ADR-029 (live mirror), and the retired-Telegram-replacement mobile bridge. Each feature landed with its own ADR or PRD, but the **umbrella itself had no decision record** — there was no canonical statement of (a) that these features form one subsystem behind one gate, (b) the gate-vs-env-override semantics, or (c) the privacy posture of the one place the mesh leaves the box.

The `[sovereign_mesh]` block currently carries: top-level toggles (`enabled`, `solid_pod`, `nostr_bridge`, `https_bridge`, `publish_agent_events`, `voice_intent`, `kg_elevation`, `junkiejarvis`, `per_user_agents`) plus the sub-tables `[sovereign_mesh.mobile_bridge]`, `[sovereign_mesh.operator]`, `[sovereign_mesh.relay]`, `[sovereign_mesh.git]`, `[sovereign_mesh.multi_user]`. This ADR records the boundary so future additions follow one shape rather than accreting ad-hoc.

Two framing tensions drive the decisions:

1. **Subsystem gate vs feature gate.** Each feature could be independently gated with no umbrella, or the umbrella `enabled` could hard-disable the whole mesh. We want both: `enabled` is the subsystem switch, and each feature carries its own gate so a partial mesh (relay on, agents off) is expressible.
2. **Manifest gate vs env override.** The manifest is the declarative source of truth, but existing deployments rely on env vars (`JUNKIEJARVIS_ENABLED`, the mirror recipient pubkeys, the bridge secrets) and would break if the manifest became the *only* path. The R7 fix resolved this: the manifest declares the gate; the env var remains the **runtime override** so a manifest-absent deployment keeps working.

## Decision

### D1: `[sovereign_mesh]` is one subsystem behind one umbrella gate

`[sovereign_mesh]` is treated as a single manifest-gated subsystem. The members are:

| Member | Gates | ADR/PRD |
|---|---|---|
| `[sovereign_mesh.relay]` | embedded Nostr relay, ingress policy, allowed kinds, fan-out | ADR-009 / PRD-004 |
| `[sovereign_mesh.operator]` | operator did:nostr identity (pubkey only; **never** the secret key) | ADR-027 D4 / PRD-004 |
| `per_user_agents` | per-user autonomous agent sessions | ADR-028 |
| `junkiejarvis` | shared forum concierge agent | PRD-008-adjacent |
| `[sovereign_mesh.mobile_bridge]` | SessionEnd digest phone egress (kind-30840) | upstream ADR-095 |
| `[sovereign_mesh.git]` | git-versioned pods | ADR-017 |
| `[sovereign_mesh.multi_user]` | multi-tenant did:nostr pods | ADR-017 / PRD-007 |

The per-turn **live mirror** (ADR-029) is the sibling egress to the mobile-bridge digest; it is gated by recipient-pubkey env presence rather than a manifest key (ADR-029 D4), but it belongs to this subsystem conceptually and shares the operator identity and the cloud relay constraint.

*Rationale:* a single umbrella makes the subsystem reviewable as a unit — the operator can reason about "is the sovereign mesh on, and what does it expose" from one block, and a new cross-cutting concern (a future audit hook, a new redaction policy) has one place to attach.

### D2: Default off; env var is the runtime override (R7)

Every gate in `[sovereign_mesh]` defaults to **off** (or to the most restrictive value — relay loopback-only, ingress `allowlist`, multi_user `closed`, mobile_bridge `enabled = false`). A feature activates only when its manifest gate is on **or** its env override is set. The env var is the **runtime override** per the just-landed R7 fix: `junkiejarvis` requires both the manifest gate `junkiejarvis = true` and `JUNKIEJARVIS_ENABLED=true`, with the env var remaining the override so manifest-absent deployments keep working; the live mirror activates on recipient-pubkey env presence (ADR-029 D4); the digest bridge stays a silent no-op until both `enabled = true` and the bridge secrets are present.

*Rationale:* default-off matches ADR-027's posture — a freshly booted agentbox exposes nothing and phones nowhere. Keeping the env var as a runtime override preserves backward compatibility for deployments that predate the manifest gates; the manifest is additive, not a breaking re-route.

### D3: The one external data hop — mobile-bridge Z.AI summarisation

The entire sovereign mesh makes **exactly one external data hop**: the mobile-bridge digest summarisation. On `SessionEnd`, when `[sovereign_mesh.mobile_bridge].enabled = true` and the secrets are present, the transcript is sent to `ZAI_URL` for distillation into a kind-30840 digest (upstream ADR-095). This is the only path where in-box content (a transcript) reaches a third-party endpoint.

Posture:
- **Fail-open / off by default.** `enabled = false` (default) does not register the SessionEnd hook; no transcript ever leaves the box. Even when enabled, it stays a silent no-op unless the bridge secrets (`AGENTBOX_BRIDGE_SK` / `AGENTBOX_BRIDGE_RECIPIENT_PUBKEY` / `AGENTBOX_POD_ROOT` / `AGENTBOX_ADMIN_PUBKEY`) and a Z.AI key are present.
- **What leaves the box, gated how.** The transcript (curated into a digest) leaves to `ZAI_URL` only. The resulting kind-30840 is signed by the bridge key (held in tmpfs per ADR-027 D4) and dual-written to the relay + pod. Pointing `ZAI_URL` at a local GLM endpoint keeps summarisation on-box and removes the external hop entirely.

Everything else in the mesh stays on-box: the relay is loopback-only by default, pods are local (ADR-010), per-user agents recall via the mandated MCP path (ADR-015), and the **live mirror has no external LLM hop at all** (ADR-029 D3) — its only egress is the encrypted gift wrap to the cloud relay.

*Rationale:* naming the single external hop makes the mesh's data-exfiltration surface auditable in one sentence: "the box phones out only when the operator turns on the digest bridge and only to the configured Z.AI endpoint." Anything that adds a second external hop must amend this ADR.

### D4: Cross-cutting middleware applies at adapter dispatch, not to operator self-egress

Per ADR-005's cross-cutting rule, the three middleware layers (observability, privacy filter ADR-008, JSON-LD encoder ADR-012) wrap every **durable-state adapter dispatch** in that order. The sovereign-mesh features that *are* adapter dispatches (pod writes via the pods slot, memory recall via the memory slot, event emission via the events slot) inherit that middleware. The operator self-egress paths (the live mirror ADR-029, and the digest's delivery to the operator's own pod/relay) are **not** adapter dispatches to third parties and sit outside the middleware chain by design — the recipient is the operator. The one external hop (D3) is gated and documented here rather than redacted by the privacy filter, because it is an opt-in operator decision to summarise their own transcript, not a federation-boundary leak of someone else's data.

*Rationale:* this keeps ADR-005's invariant honest — the middleware governs federation-boundary adapter dispatch, and the mesh's operator-only egress is explicitly scoped out (and re-evaluated if it ever targets a non-operator recipient, per ADR-029 D5).

## Consequences

### Positive
- The sovereign mesh is reviewable as one subsystem: one block, one gate convention, one named external hop.
- Default-off + env-override gives both privacy-by-default and backward compatibility.
- The data-exfiltration surface of the whole mesh is one sentence (D3), auditable in CI and docs.

### Negative
- The umbrella couples several independently-shipped features (relay, agents, pods, bridges) under one block; a reviewer must still consult the per-feature ADR for semantics — this ADR is the boundary, not the implementation.
- The gate-vs-env-override duality means a feature can be "on" via env even when the manifest says off; the env override is the documented escape hatch, but it is a place where manifest and runtime state can diverge.

### Risks
- Adding a sub-table under `[sovereign_mesh]` without amending this ADR re-introduces the original gap (a mesh member with no boundary record). The `review_trigger` is set to catch exactly this.
- If a future feature adds a second external hop without amending D3, the "one external hop" guarantee silently becomes false. D3 is the load-bearing invariant.

## Cross-references

- **Live egress sibling:** ADR-029 records the per-turn live mirror (no external hop, derived child key); this ADR records the manifest boundary it lives behind.
- **Digest egress:** upstream ADR-095 records the kind-30840 digest (the one external hop, D3); ADR-094 records the phone NIP-26 delegation.
- **Per-user agents:** ADR-028 (ratified Accepted) names its gate as `[sovereign_mesh].per_user_agents` — see the gate-key alignment note in ADR-028.
- **Cross-cutting rule:** ADR-005 (middleware order), ADR-008 (privacy filter), ADR-012 (JSON-LD encoder).
