---
id: ADR-2012
title: Relay ingress is allowlist-only with no fallback and no auto-add
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: ingress_policy changes from allowlist, or the ADR-040 D3 governance-publisher key-split lands
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-040 (learning consumers / governance publisher key-split), sovereign-mesh relay posture (DDD-003)
---

# ADR-2012 — Relay ingress is allowlist-only, no fallback, no auto-add

## Context
The embedded nostr-rs-relay accepts inbound events from the mesh. An open or
signed-only relay would admit any well-formed event; the sovereign posture
requires that only known keys can write. Earlier designs auto-added the operator
pubkey at boot — that claim now matches no code and is a silent trust widening.
The allowlist is baked at nix build from `relayAllowedPubkeysCsv`, so its
contents are a build-time artefact. Governing doc: `docs/INGRESS-identity.md`.

## Decision
Relay ingress policy is `allowlist` — not `signed-only`, not `open`. Inbound
events are admitted only from a static list of 64-hex pubkeys baked at build
time. There is no fallback and no auto-add: the operator pubkey is not
auto-inserted at boot, and an empty allowlist drops every inbound event.
Per-agent event emission additionally requires NIP-98 (`agent_event_auth =
"nip98"`). This forecloses open/signed-only relay modes and any runtime
widening of who may write to the relay.

## Consequences
Only enumerated keys can publish to the relay; an empty list is fail-closed, not
fail-open. Cost: allowlist changes are build-baked — adding a publisher needs a
rebuild and is staged to the next deploy, not hot-editable. Open follow-on: the
ADR-040 D3 governance-publisher key-split is still pending, so the
visionclaw-server publisher key is currently shared rather than split.

## Verification
Re-checked at `cbe7335b9`: `agentbox.toml:138` (`ingress_policy = "allowlist"`),
`:140-141` (comment: "NO fallback and NO auto-add: empty = every inbound relay
event is dropped"), `:144-153` (static `allowed_pubkeys`), `:172`
(`agent_event_auth = "nip98"`), `:148` (key-split pending, ADR-040 D3). Baked via
`flake.nix:1186` (`relayAllowedPubkeysCsv`), exported as
`AGENTBOX_ALLOWED_PUBKEYS` at `flake.nix:1852`.
