---
id: ADR-2023
title: The Loom is a façade — consumers hold the :8084 door and the model is a swappable URL behind it
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 1ee6f6f1a9be19f7331643727a08e4061665532c
verified_paths: [agentbox.toml, mcp/servers/lib/ontology-retrieval.js]
owner: jjohare
review_trigger: model swap behind the Loom, or ADR-051 deferred-distillation MCP tools becoming a discrete server
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-051 (Loom client + deferred distillation, status 'proposed'), ADR-045 (sovereign ingress / one front door)
---

# ADR-2023 — The Loom is a façade — consumers hold the :8084 door and the model is a swappable URL behind it

## Context

The self-hosted reasoning model must be swappable without touching every
consumer. The old `192.168.2.48` model host is dead; naming a raw model port in
consumer config re-creates the same brittle coupling. ADR-045 established one
front door; ADR-051 (still 'proposed') sketched the Loom client and deferred
distillation. The Loom is the stable model-swap door — a façade at
`http://192.168.2.132:8084/v1` that grounds calls in the ontology and delegates
to whatever model sits behind it (currently `qwen3.8-27B`).

## Decision

Scaffolded consumers call the stable façade `http://192.168.2.132:8084/v1` and
**never a raw model port**. Ontology retrieval resolves through the Loom when
`LOOM_FACADE_URL` is set (seed via `/loom/search`, expand via `/loom/sparql`),
falling back transparently to VisionClaw when it is unset. Swapping the deployed
model behind the façade must not touch any consumer. This is the interim
governing decision; the ADR-051 deferred-distillation MCP tools are **not yet a
discrete server** — hence implementation partial.

## Consequences

- The model becomes an operational detail: a swap is a change behind :8084, not
  a fleet-wide config edit.
- Retrieval degrades gracefully — an unset/absent Loom falls back to VisionClaw
  rather than failing the turn.
- Cost/caveat: retrieval-through-Loom is live, but the fuller ADR-051 surface
  (deferred distillation as its own MCP server) is deferred; the façade contract
  is currently expressed as config + a retrieval lib, not a single enforcing
  service. Governing detail in `docs/GOVERNANCE-capabilities.md`.

## Verification

At `cbe7335b9`, `agentbox.toml`: `loom_url = "http://192.168.2.132:8084/v1"`,
`loom_model = "qwen3.8-27B"`, `loom_max_tokens = 16384` (:1564-1566), and the
condense `endpoint` façade at :650 commented "Ontology Loom façade (model-swap
door; DNAT via ml). Was the dead .48 host."
`mcp/servers/lib/ontology-retrieval.js`: `LOOM_FACADE_URL` seed+expand path with
transparent VisionClaw fallback (:339-417).
