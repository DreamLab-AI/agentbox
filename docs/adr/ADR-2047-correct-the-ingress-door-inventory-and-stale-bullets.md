---
id: ADR-2047
title: Correct the ingress door inventory, the resolved divergence bullets, and the voice routing table
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any change to the SANCTIONED list in scripts/ci/check-ports-loopback.mjs, or to the voice Caddyfile route map
repo: agentbox
domain: INGRESS-identity
lineage: ADR-2013 (loopback publish + sanctioned list), ADR-2009 (nip98-proxy identity boundary), legacy ADR-069 (unified operator auth / credential exchange)
---

# ADR-2047 — Correct the ingress door inventory, the resolved divergence bullets, and the voice routing table

## Context

`docs/INGRESS-identity.md` is the compliance surface for ingress, so stale text in
it is a governance defect, not a typo. The 2026-09-05 diagram pass (**AB-10.1**,
**AB-12.1**, **AB-12.10**) found four statements that the code has moved past:

1. Divergence bullet 1 framed the voice `:8444` publish as an admitted breach of
   "one front door". It is a decided exposure: `check-ports-loopback.mjs:75-86`
   sanctions ten mappings, each cited at `:55-73`, and CI enforces the list.
2. Divergence bullet 2 said `flake.nix` still carried a `--auth none` comment.
   `flake.nix:2515` already reads `--auth token`; the bullet outlived its defect.
3. "Compose exposure qualification — 2026-09-04" described a line-oriented `ports`
   walker as the current gate. That walker was replaced by a parsing gate.
4. `voice/README.md:100-101` routed `/feed` and `/bridge/*` directly to
   `agentbox:8971`. `voice/console/Caddyfile:97-105` routes both through
   `agentbox:9096` with server-side `BRIDGE_TOKEN` injection, so the browser never
   holds the bridge secret.

The door inventory also understated the surface: it opened "Only two ports leave
the container", counting neither `:8443` nor the sidecar publishes.

## Decision

The governing doc states the LAN surface as it is: `:9096` is the sole
identity-gated ingress **to the AoE interaction plane**, and the estate publishes
ten sanctioned mappings across five compose files, each carrying its own auth and
its own citation in the gate's `SANCTIONED` list. "Sole ingress" is scoped to the
plane it protects, never used as a claim about the whole estate.

A divergence bullet whose defect has been fixed is rewritten in place as
`Resolved — ADR-20xx (date)` with the evidence, not deleted. Deleting it loses the
fact that the concern was raised and answered; leaving it unmarked makes the doc
lie. Superseded qualification text is kept verbatim under a "Historical text"
label for the same reason.

Route tables in operator documentation name the port the traffic actually reaches
and the credential boundary it crosses.

## Consequences

- INGRESS-identity's "Known divergences" list now distinguishes open items
  (ADR-040 key-split, unsigned pod-signing fallback, break-glass over LAN,
  per-boot session secret) from answered ones, so a reader can act on the list.
- The count in the door inventory is now maintainable against a single source —
  the gate's `SANCTIONED` list — rather than restated prose that drifts.
- An operator following `voice/README.md` will no longer try to reach
  `:8971` directly and find the credential exchange missing.
- Cost: two more places (this ADR and the diagram notes) must be updated whenever
  the sanctioned list changes. `review_trigger` names that event.

## Verification

Verification ran on the uncommitted working tree above `verified_commit`
89301ec7c911eab270c00a0cf81596d0d4f15535 and must be re-run at the landing commit.

- Sanctioned list read directly at `scripts/ci/check-ports-loopback.mjs:75-86`:
  `docker-compose.yml` 9096; `docker-compose.voice.yml` 8443 and 8444;
  `docker-compose.browsercontainer.yml` 5903, 8931, 9222→9223;
  `docker-compose.gui-tools.yml` 5905, 9876, 9877; `docker-compose.xr-runtime.yml`
  5904. Ten entries. Per-entry rationale at `:55-73`.
- `docker-compose.voice.yml:37-40` confirms **both** `0.0.0.0:8443:8443` and
  `0.0.0.0:8444:8444` are published, with the inline comment ":8443 stock Unmute
  debug UI; :8444 the operator console (self-signed TLS)".
- `flake.nix:2515` reads `# (aoe serve, --auth token) is NEVER published.` —
  bullet 2's defect is gone.
- `voice/console/Caddyfile:97-105` routes `/feed` and `/bridge/*` to
  `agentbox:9096`, with the ADR-069 comment at `:95-96` stating the browser never
  holds the bridge secret. Line 27 of `voice/README.md` is unchanged and remains
  correct: that is the Unmute backend calling the bridge container-to-container on
  the docker network, not a browser path through Caddy.
- `sh scripts/ci/check-ports-loopback.sh` → `PASS (check-ports-loopback): 10
  compose file(s), 7 ports block(s) — all publishes loopback-only or explicitly
  sanctioned`.

**Governed paths changed.** `docs/INGRESS-identity.md`, `voice/README.md`.
Diagram notes updated in `docs/diagrams/agentbox/10-ingress-nip98-proxy-and-aoe.md`
and `docs/diagrams/agentbox/12-tab0-bridge-and-interaction-plane.md` (VisionClaw repo).
