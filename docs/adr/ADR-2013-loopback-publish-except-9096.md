---
id: ADR-2013
title: Every host port publish binds 127.0.0.1 except the single :9096 sovereign ingress, CI-enforced
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A second non-loopback publish is added to docker-compose.yml, or the voice cockpit :8444 exposure is folded into this gate
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-045 (sovereign ingress front door), R-003 (loopback publish rule)
---

# ADR-2013 — Loopback-only host publishes except the :9096 sovereign ingress

## Context
The identity boundary (ADR-2009) is only as strong as the exposure surface
around it. If any container service publishes on a routable interface, it
becomes a second door around the nip98-proxy. The exposure invariant must be
structurally checkable in CI, not a review convention — short-syntax publishes
are easy to audit, but long-syntax (`published:`/`host_ip:`) mappings would slip
past a naïve parser. Governing doc: `docs/INGRESS-identity.md`.

## Decision
No container service in `docker-compose.yml` is published on a routable
interface except the exact `9096:9096` nip98-proxy mapping (the sovereign
ingress). A CI gate (`scripts/ci/check-ports-loopback.sh`) parses the compose
file: short-syntax publishes must be `127.0.0.1:*` or the exact `9096:9096`
exception, else it fails; long-syntax `published:`/`host_ip:` mappings are
forbidden outright so a bypass is structurally impossible. This forecloses any
non-loopback publish and any port-mapping form the gate cannot audit.

## Consequences
The exposure surface is a single reviewed line and a passing CI gate. Cost: the
gate only audits `docker-compose.yml` short syntax — additional compose overlays
are outside its scope. Divergence in live reality: the voice cockpit publishes
`:8444` on `0.0.0.0` from `docker-compose.voice.yml`, which this gate does not
inspect, so there is a second LAN ingress the invariant does not yet cover. That
overlay must be brought into scope or explicitly excepted.

## Verification
Re-checked at `cbe7335b9`: `scripts/ci/check-ports-loopback.sh` — `127.0.0.1:*`
OK, `9096:9096` exact exception, everything else fails; long-syntax
`published:`/`host_ip:` grep forbidden. The `9096:9096` LAN publish is declared
at `flake.nix:1997` (D2 exposure policy). Voice `:8444` divergence lives in
`docker-compose.voice.yml`, outside the gate's parsed file.
