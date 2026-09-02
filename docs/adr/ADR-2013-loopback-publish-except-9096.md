---
id: ADR-2013
title: Every compose publish binds 127.0.0.1 unless on the sanctioned-exposure list, CI-enforced across all overlays
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 1ee6f6f1a9be19f7331643727a08e4061665532c
verified_paths: [scripts/ci/check-ports-loopback.sh, .github/workflows/invariants.yml, flake.nix, docker-compose.yml]
owner: jjohare
review_trigger: Any new entry on the SANCTIONED list, or a new compose overlay file
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-045 (sovereign ingress front door), R-003 (loopback publish rule); scope extended to all overlays 2026-08-31 (external review closure 3)
---

# ADR-2013 — Loopback-only compose publishes except the sanctioned-exposure list

## Context
The identity boundary (ADR-2009) is only as strong as the exposure surface
around it. If any container service publishes on a routable interface, it
becomes a second door around the nip98-proxy. The gate originally parsed only
`docker-compose.yml`, which left the voice cockpit (`:8443`/`:8444`) and three
sidecar overlays (browsercontainer, gui-tools, xr-runtime) publishing `0.0.0.0`
uninspected — an admitted invariant breach while the record claimed
complete/live. The invariant must cover every compose file, with every
intentional exposure modelled rather than hidden. Governing doc:
`docs/INGRESS-identity.md`.

## Decision
The CI gate (`scripts/ci/check-ports-loopback.sh`) sweeps **every**
`docker-compose*.yml`. A publish must bind `127.0.0.1:` or appear on the
in-script `SANCTIONED` list — an explicit `(file, mapping)` inventory of the
LAN doors, each citing its governing rationale: `9096` (ADR-045 sovereign
ingress), voice `8443`/`8444` (cockpit TLS door — the former "second LAN
ingress" is now modelled, not silent), browsercontainer `5903`/`8931`/`9222`
(sidecar VNC / MCP SSE / raw CDP), gui-tools `5905`/`9876`/`9877`, xr-runtime
`5904`. Anything else fails CI. Long-syntax `published:`/`host_ip:` mappings
are forbidden in every file so a bypass is structurally impossible. Adding a
SANCTIONED line is a security decision requiring a citation. This forecloses
silent new LAN doors in any overlay, present or future.

## Consequences
- The complete LAN exposure surface is one reviewed list in one script plus a
  passing CI gate — an auditor reads ten lines to know every door.
- The voice cockpit and sidecar exposures are now *decided* exposures; closing
  or narrowing any of them is a one-line delete that CI then enforces.
- Cost: the sanctioned list must be maintained alongside overlay changes; a
  legitimate new exposure fails CI until explicitly sanctioned (that friction
  is the point).

## Verification
Re-checked 2026-08-31 (gate-extension commit): `scripts/ci/check-ports-loopback.sh`
iterates `"$ROOT"/docker-compose*.yml`; run locally passes with the ten
sanctioned mappings and fails on any unsanctioned `0.0.0.0` publish (negative
test: three deliberately-wrong container ports were rejected before the list
was corrected). Wired in `.github/workflows/invariants.yml`. The `9096:9096`
LAN publish remains declared at `flake.nix:1997` (D2 exposure policy).
