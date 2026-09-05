---
id: ADR-2055
title: Describe opf-router as the privacy-filter sidecar on its own port, never as a facade on the Loom's
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a change to [privacy_filter].port, to the [program:opf-router] supervisor block, or to the BASELINE-container supervised-program table
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-008 (privacy-filter routing, defines opf-router at :9092), ADR-2023 (the Loom facade at :8084)
---

# ADR-2055 — Describe opf-router as the privacy-filter sidecar on its own port, never as a facade on the Loom's

## Context

`docs/BASELINE-container.md` lists, in its supervised-program table:

> `| opf-router (:1873) | OpenAI-compatible façade router | :8084 |`

Both the description and the port are wrong, and they are wrong in the same direction —
they describe the Loom:

- `opf-router` is the **privacy-filter redaction sidecar** (legacy ADR-008): a stateless
  local service running `openai/privacy-filter` that the adapter-dispatch middleware
  consults to redact prompts and durable writes. ADR-008 itself labels it
  `opf-router (:9092)`. It is not an LLM router and routes no completions.
- Its port is **9092**: `agentbox.toml [privacy_filter].port = 9092`,
  `scripts/opf-router.py` `PORT = int(os.environ.get("OPF_PORT", "9092"))`, and the
  generated `[program:opf-router]` supervisor block sets `OPF_PORT` from the same
  manifest key with a 9092 fallback.
- `:8084` is the **Ontology Loom facade** on machinelearn (ADR-2023), a different service
  on a different host reached by DNAT. **No agentbox program serves `:8084`.**

The conflation is load-bearing, not cosmetic: it caused a downstream reader of this
document to brief an entire diagram lane that the Loom was an agentbox-supervised
program. Exposed by diagram AB-24.1.

## Decision

Documentation names `opf-router` as the privacy-filter sidecar and cites its port from
`agentbox.toml [privacy_filter].port` (ADR-2052's key-anchored form). The BASELINE
supervised-program row reads, in substance: *privacy-filter redaction sidecar
(ADR-008)*, port *`127.0.0.1:9092`*.

No document describes any agentbox-supervised program as serving `:8084`. Where a doc
needs to mention `:8084` it says explicitly that it is the Ontology Loom facade on
machinelearn, reached over the LAN, and cross-references ADR-2023.

`docs/BASELINE-container.md` is owned by the runtime lane, so the exact row edit is
**routed** to that owner rather than applied here; `implementation_status` stays
`partial` until it lands. This ADR is the authority for the correction and the diagram
carries `RESOLVED ADR-2055` now, because the *code* was never wrong — only the
description of it.

## Consequences

- A reader can no longer conclude that agentbox hosts the Loom, or that the privacy
  filter is an LLM router. Those are the two errors this row produced.
- The privacy filter's real role — a fail-open redaction hop in the adapter middleware
  chain (observability → privacy → JSON-LD) — becomes findable from the baseline doc.
- Follow-on, routed to the runtime lane: correct the `opf-router` row's description and
  port, and re-check every supervisor line reference in that table. They are stale by
  **differing** amounts (+242 for `nostr-gateway` and `jupyter-lab`, +270 for
  `opf-router`), so this needs a per-row sweep, not a bulk shift — and it is a standing
  argument for citing supervisor blocks by `[program:<name>]` rather than by line, in
  the spirit of ADR-2052.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- `grep -n 'opf-router' docs/BASELINE-container.md` → the row asserting
  "OpenAI-compatible façade router" and `:8084`.
- `grep -n 'OPF_PORT' scripts/opf-router.py` → `PORT = int(os.environ.get("OPF_PORT", "9092"))`.
- `grep -n -A3 '^\[privacy_filter\]' agentbox.toml` → `enabled = true`, `mode = "local-cpu"`,
  `port = 9092`.
- `grep -n 'OPF_PORT' flake.nix` → the `[program:opf-router]` environment line and the
  image-env line, both defaulting to `9092`.
- `grep -rn 'opf-router' docs/archive/adr/ADR-008-privacy-filter-routing.md` → the ADR's
  own sequence diagram participant `OPF as opf-router (:9092)`, confirming 9092 is the
  designed port and the BASELINE row is the outlier.
- `grep -n '8084' flake.nix` → two matches, **both outbound client URLs and neither a
  bind**: the `[program:dream-engine]` environment line's
  `LOOM_URL=…192.168.2.132:8084/v1` default, and a compose `LOOM_BASE_URL` default.
  No supervisor block listens on `:8084`.
- Table-drift sample, showing the stale line references are **not** a uniform offset and
  need a per-row sweep rather than a bulk shift:
  `nostr-gateway` cited `:1567`, actual `[program:nostr-gateway]` at `:1809` (+242);
  `jupyter-lab` cited `:1610`, actual at `:1852` (+242);
  `opf-router` cited `:1873`, actual at `:2143` (+270).
