---
id: ADR-039
title: "docBox back-ports: apply-class taxonomy, /v1/system live manifest, hash-chained events log"
status: accepted
date: 2026-07-19
type: architecture
author: Dr John O'Hare
depends_on: [ADR-005, ADR-013]
related: [ADR-008, ADR-012, ADR-024, ADR-035]
review_trigger: the events slot gains an external implementation that needs chain semantics of its own; or a config hot-reload path lands (a fourth apply class); or off-box chain anchoring (nostr / Merkle) is implemented; or the catalogue drifts measurably from agentbox.toml (a gate with no catalogue entry, or vice versa)
"@context": https://schema.org
"@type": TechArticle
---

# ADR-039 — docBox Back-Ports: Apply-Class Taxonomy, /v1/system, Hash-Chained Events

**Status:** Accepted (implemented)
**Date:** 2026-07-19
**Repo:** DreamLab-AI/agentbox
**Provenance:** [DreamLab-AI/docBox](https://github.com/DreamLab-AI/docBox) — a deliberate *distillation* of agentbox built for a client team. Its ADR-002 (apply-class model), ADR-009 (slim core / surfaces / modules) and PRD-006 (hash-chained audit) were evaluated for back-porting. This ADR records what was ported, what was improved in transit, and what was deliberately rejected.

## Context

docBox was designed as "a distillation, not agentbox" — but three of its consumer-facing conventions turned out to answer questions agentbox could not:

1. **"If I flip this manifest key, when does it actually apply?"** agentbox's `agentbox.toml` gates are richly documented in the schema, but the *apply semantics* (restart vs Nix image rebuild vs read-at-op-time) lived only in prose convention ("gate both the Nix package set and the supervisor block") and entrypoint comments. No runtime surface, no per-key classification.
2. **"What is the box made of, and what is on?"** The full gate map was never served over HTTP. `/v1/meta` stops at image hash + manifest checksum + adapter impls; the setup dashboard edits the TOML pre-boot but doesn't render the composed system.
3. **"Can anyone tamper with the event log?"** The events adapter's durable JSONL (`{ts, session_id, execution_id, kind, payload}`) had no integrity story. Per-event authenticity exists elsewhere (Schnorr-signed kind-30840/30841 on the pod-bridge path; content-addressed PROV-O URNs) but nothing chains records — deletion, edit, splice, and reorder were all undetectable.

## Decision

Port three patterns; improve two of them in transit; reject three others.

### D1 — Apply-class taxonomy: `live | boot | rebuild`

Every catalogued gate carries a fixed, hand-assigned apply class (docBox ADR-002's discipline: the class is a property of the option, never inferred). agentbox uses **three** classes, not docBox's four:

| Class | Semantics |
|---|---|
| `live` | Read at operation time — flipping the key affects the running box (memory-hygiene op gates, compose-managed sidecars driven by `agentbox.sh`) |
| `boot` | Read once at container boot — takes effect on the next restart; the entrypoint reconciles every boot (most gates) |
| `rebuild` | Changes the Nix image composition — requires `./agentbox.sh rebuild`; gate both the package set and the supervisor block (all `toolchains.*`, Nix-baked services) |

docBox's `hot` class (self-modifying UI layout) has no agentbox referent, and its `session` class collapses into `boot` because the entrypoint reconciles per boot, not per agent session. If a config hot-reload path ever lands, that is a new class and a review trigger.

### D2 — `/v1/system`: the live system view

`management-api/routes/system.js` + `management-api/lib/system-manifest.js`. The docBox System-tab convention (slim core / surfaces / modules, ADR-009) re-expressed with one structural improvement: docBox hand-authors both the catalogue *and* the state; agentbox hand-authors only the **catalogue** (id, gate path, layer, apply class, summary — documentation-as-data), while the **state** (`on | off | available`) is introspected from the parsed `agentbox.toml` at request time and the **core layer** is composed from the resolved adapter registry (slot, impl, contract version). The catalogue can drift (a new gate needs a new entry — the manual-honesty burden docBox accepts); the state cannot.

Multi-gate entries are supported (`gates: [...]`, any-true = on) for sections like `[memory_hygiene]` that gate per-operation rather than per-section.

Mounted unconditionally (like `/v1/uri` — core observability of the box, not an optional capability), authed (not on the public allow-list), read-only, plain JSON (a JSON-LD rendering would be a new opt-in surface under ADR-12's per-surface gating if ever wanted).

### D3 — Hash-chained events log + `/v1/system/audit-chain`

`management-api/lib/audit-chain.js` (pure `node:crypto`, ported from docBox `server/src/audit/chain.ts`) + chain production inside the `local-jsonl` events adapter. Every dispatched record now carries `seq`, `prev_hash`, `hash` where:

```
hash = SHA256(prev_hash ‖ canonical_json(record − {prev_hash, hash}))
```

Canonicalisation is a deep key-sort at every depth (array order preserved) — load-bearing, else a key-order reserialise reads as tampering. The chain threads across daily file rotation and process restarts (tail resumed from the newest file on first append) and only advances on a successful write, so a failed append can never leave the chain pointing at a record that was never persisted. Records written before this ADR verify as a tolerated `legacy_prefix`; once chaining starts, an unchained record is a break.

`GET /v1/system/audit-chain[?days=N]` walks the files and reports `{ok, checked, legacy_prefix, broken_at, reason, tail_hash}`. Detectable tamper modes: edit (hash mismatch), splice (prev_hash mismatch), reorder (splice at first moved record). **Tail truncation is the one blind spot of a bare chain** — the mitigation is publishing `tail_hash` off-box, which agentbox is unusually well-placed to do (a signed nostr event on the existing mesh, sibling of kind-30840); that is specified as follow-up, not implemented, mirroring docBox's own unimplemented `anchored` flag.

The adapter **contract is unchanged**: `dispatch/subscribe/unsubscribe` signatures, return values, and off-class semantics are untouched; chain fields are additive record content in one implementation class. `tests/contract/events-audit-chain.test.js` covers the lib (edit/splice/reorder/legacy) and the adapter (genesis chaining, restart resume, legacy tail).

### Rejected ports

- **SSE `Last-Event-ID` replay** — docBox ADR-005 names it but does not implement it; agentbox's agent-events WS already ships connect-time history. Nothing to copy.
- **Mock-first seam + two-axis demo banner** (docBox ADR-001) — genuinely excellent for a consumer web UI; agentbox's management-api has no comparable UI surface, and grafting it onto the setup dashboard is a separate UX project, not a back-port.
- **Blue/green rebuild with restic snapshot + EXIT-trap auto-rollback** (docBox `scripts/rebuild.sh`) — the strongest *candidate* rejected: agentbox has backup/restore and sidecar-scoped snapshot rehearsal but no box-level config-change rollback. Deferred because it requires the three-plane volume split and compose-project isolation docBox was designed around; the apply-class taxonomy (D1) documents the gap it would fill. Revisit when `rebuild`-class changes become frequent enough to hurt.

## Consequences

- Operators (and agents) can ask the box what it is made of, what is on, and what flipping any gate costs — `GET /v1/system` — instead of reading `agentbox.toml` + `flake.nix` side by side.
- The events log is tamper-evident from this date forward; pre-existing records remain readable as a legacy prefix. Chain verification is one authed GET.
- The catalogue in `system-manifest.js` joins the "docs to keep in sync" set: a new manifest gate should add a catalogue entry (state introspection makes the omission visible as a missing module rather than a wrong one).
- No new adapter slot, no new URN kind, no new port, no new dependency (chain lib is `node:crypto` only) — consistent with the ADR-035 precedent of re-expressing capability on existing substrates.
