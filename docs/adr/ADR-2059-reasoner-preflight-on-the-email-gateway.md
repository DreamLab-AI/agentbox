---
id: ADR-2059
title: Fail fast on a reasoner URL that resolves but black-holes
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a preflight landing in the email gateway, or another 180 s synthesis stall traced to REASONER_BASE_URL
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2023 (the Loom façade is the stable model-swap door), ADR-2055 (opf-router is not that door)
---

# ADR-2059 — Fail fast on a reasoner URL that resolves but black-holes

## Context

`skills/email-search/SKILL.md` documents the August 2026 failure precisely: a stale
`REASONER_BASE_URL` pointing at `192.168.2.48:8084` — HP's dead old LAN address — makes
every synthesis stall to a 180 s timeout while `GET /health` still returns 200. Health is
green, the container is alive, and every reasoning call black-holes. The recorded fix is
`REASONER_BASE_URL=http://192.168.2.132:8084/v1` and a recreate.

The documentation is correct and complete. What is missing is **detection**: nothing
fails fast on a reasoner URL that resolves but does not answer. The operator experiences
a 180 s mystery and whole-session tool loss, and the only route to the diagnosis is
reading the skill's failure-handling section — a human step, at exactly the moment the
tooling is unusable. Raised by the estate lane while drawing the mail path.

This is the same class as ADR-2055: a dead `.48` address surviving in configuration, and
a surface that looks healthy while being wrong.

## Decision

**Proposed, not implemented** — the email gateway itself is not in this lane's file set;
the skill that documents the failure is. This ADR records the decision and its acceptance
test so the gap is tracked rather than re-discovered on the next outage.

The decision, when taken: the gateway performs a **startup preflight** against
`REASONER_BASE_URL` — one cheap `GET /v1/models` with a short timeout (a few seconds, not
180). On success it logs the resolved backend identity. On timeout or transport failure it
logs loudly at error level, naming the URL it tried, and marks itself **degraded** so
`/health` reports the degradation rather than a bare 200. It does **not** exit: the
gateway's non-reasoning surfaces stay usable, and a reasoner that recovers later is picked
up on the next call.

`/health` distinguishes *configured-but-unreachable* from *not configured*, matching the
vocabulary the retrieval brain already uses (`backend_configured_but_unavailable` versus
`backend_not_configured`, `mcp/servers/lib/ontology-retrieval.js`). Collapsing the two is
what lets a dead façade hide behind a normal-looking fallback.

## Consequences

- A 180 s mystery becomes a boot-time error naming the exact URL — the difference between
  an afternoon and a minute.
- `/health` stops being a liveness lie for the reasoning path. Anything monitoring it gets
  a true signal.
- Cost: one extra call at startup, and a `/health` contract change that any consumer
  parsing it must tolerate. The preflight must not become a hard gate — a reasoner down at
  boot should degrade the gateway, not prevent it starting.
- This does not fix a stale URL; it makes a stale URL *loud*. The configuration remains
  the operator's to get right.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty. `implementation_status: none` — this records a
decision and a plan, not a change.

- The failure mode and its fix are documented in `skills/email-search/SKILL.md`
  (failure-handling section): a stale `REASONER_BASE_URL` at `192.168.2.48:8084`
  black-holes synthesis while `/health` returns 200, producing 180 s `refresh_inbox`
  stalls. Three of that file's lines carrying the dead `.48` address are `lint-ok`-suppressed
  precisely because they are the documented fingerprint rather than live configuration.
- The dead address is estate-wide knowledge: `grep -rn '192.168.2.48' skills/` also hits
  `web-summary/references/architecture.md` ("Never target `192.168.2.48` — HP's old
  address is dead and black-holes"), and `skills/lint-skills.mjs` bans the string as a
  stale-host check.
- The precedent for the degraded-state vocabulary is live in
  `mcp/servers/lib/ontology-retrieval.js`: `DEGRADED_OUTCOMES.BACKEND_CONFIGURED_UNAVAILABLE`
  is deliberately distinct from `BACKEND_NOT_CONFIGURED`, with the in-code rationale that
  "collapsing the two hides a dead façade behind a normal fallback".

**Acceptance test for the landing change:** with `REASONER_BASE_URL` pointed at a
black-holing address (a routable IP that drops packets), the gateway starts, logs an error
naming that URL within the preflight timeout, and `GET /health` reports degraded with the
configured-but-unavailable reason; `refresh_inbox` then fails fast with the same reason
rather than stalling for 180 s. With the URL correct, `/health` is unchanged from today
and the preflight adds no user-visible latency beyond one `/v1/models` call.
