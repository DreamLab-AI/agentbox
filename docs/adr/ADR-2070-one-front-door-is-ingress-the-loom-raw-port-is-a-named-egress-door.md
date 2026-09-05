---
id: ADR-2070
title: ADR-045's one front door governs ingress; the Loom's raw model port is a named egress door
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: a third Loom-side endpoint is published, the raw door acquires a non-coding consumer, or ADR-051/ADR-2023 ratifies and takes back Loom authority
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-045 (sovereign ingress, one npub-gated front door), ADR-051/ADR-2023 (Loom façade), ADR-2055 (do not conflate the privacy filter with the Loom)
---

# ADR-2070 — ADR-045's one front door governs ingress; the Loom's raw model port is a named egress door

## Context

`docs/GOVERNANCE-capabilities.md` divergence 3 read: *"ADR-045 'one front door'
publishes two LAN doors — the scaffolded façade (:8084) and raw model (:8085) are
both reachable; consumers must pick correctly per task."* That framed a deliberate
design as a governance breach, and it is a category error. ADR-045 is about
**ingress**: external control surfaces reaching **into** the box, behind the
NIP-98-verifying proxy on `:9096` as sole identity ingress
(`docs/archive/adr/ADR-045-sovereign-ingress-npub-front-door.md`). The Loom
endpoints are **egress**: the box reaching **out** to a LAN model host on
machinelearn. Two different planes; ADR-045 never spoke to the second. Meanwhile the
raw door is not an accident — it is named in two places
(`agentbox.toml` `[[interaction_plane.session_seeds]]` `slug = "loom-raw"`,
`flake.nix` `LOOM_RAW_BASE_URL` defaulting to `http://192.168.2.132:8085/v1`) with a
stated purpose.

## Decision

The raw door **stays**, as a deliberate, named, second **egress** door, bounded by
these conditions:

1. **ADR-045's "one front door" is an ingress invariant** and is not evidence about
   egress. The sole-ingress claim continues to bind `:9096` unchanged.
2. **The Loom's own one-door rule is the model-swap contract**, not port count:
   every consumer doing scaffolded or knowledge work holds the façade `:8084` and
   never a raw model port, so the model swaps behind it with zero consumer change.
   That invariant is unchanged and remains the load-bearing one.
3. **The raw door is agent-choice and benchmark-only.** Its sanctioned consumers are
   the explicitly-chosen `loom-raw` interaction-plane session (raw coding, where the
   ontology scaffold is cost without benefit) and benchmark harnesses measuring
   scaffold-versus-no-scaffold. It is **not** a fallback for the façade, **not** for
   knowledge work, ontology retrieval, or email, and nothing may route to it
   automatically on a façade error — a scaffold failure must surface, not silently
   downgrade to an ungrounded model.
4. **Adding a third Loom-side endpoint requires an ADR.** Two named doors is the
   ceiling; drift to three is a decision, not a config edit.

## Consequences

- Divergence 3 is retired as a divergence and restated as the constraint above;
  `docs/GOVERNANCE-capabilities.md` is corrected accordingly.
- A consumer picking the raw door for knowledge work is now a defect with a named
  rule to cite, where previously it was "consumers must pick correctly per task"
  with no stated criterion.
- Cost: the constraint is documentary. Nothing enforces at runtime that a
  knowledge-work consumer holds `:8084` — no proxy or lint checks which base URL a
  session opened. That enforcement is unbuilt, and this ADR does not claim it.
- The privacy posture is unchanged: both doors are LAN-only against the same
  self-hosted model, so the raw door adds no egress off the LAN. It does remove
  ontology grounding, which is a quality property, not a privacy one.

## Verification

At `e070514d808b218574403377fb75e0e1a0a256b3`: the façade is `agentbox.toml`
`[dream_machine].loom_url = "http://192.168.2.132:8084/v1"`; the raw door is
`flake.nix` `LOOM_RAW_BASE_URL` (default `http://192.168.2.132:8085/v1`) and the
`slug = "loom-raw"` / `model = "loom-raw/qwen3.8-27B"` session seed in
`agentbox.toml [[interaction_plane.session_seeds]]`, commented "Raw Qwen via :8085 —
no Loom scaffold, for coding tasks". ADR-045's scope was read directly from its
Context (the `:9096` proxy as sole ingress for external **control surfaces**), which
is what establishes the ingress/egress distinction this record turns on. A grep for
`8085` across the tree found no consumer outside those two declarations, the
email-search and web-summary skill docs (which describe the model behind the façade,
not a raw consumer), and archived ADR text.
