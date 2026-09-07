---
id: ADR-2023
title: The Loom is a façade — consumers hold the :8084 door and the model is a swappable URL behind it
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: ee742ade57ddca06ba846676e6006171ec76c49d
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

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `agentbox.toml` gate additions elsewhere in the manifest and by the ADR-2016/2054 rework touching `mcp/servers/lib/ontology-retrieval.js`; neither alters the façade contract, so the decision still holds. Re-checked at HEAD: `agentbox.toml:1672-1673` `loom_url = "http://192.168.2.132:8084/v1"` and `loom_model = "qwen3.8-27B"`, `:1677` `loom_max_tokens = 32768`, and the condense endpoint façade at `:656` commented "Ontology Loom façade (model-swap door; DNAT via ml). Was the dead .48 host." (every line number in the Verification paragraph above — `:1564-1566`, `:650` — has drifted). `mcp/servers/lib/ontology-retrieval.js:472` reads `LOOM_FACADE_URL` and `:463-466` documents the transparent VisionClaw selection when it is unset, so the fallback is an ordinary path rather than a fault. The `loom_max_tokens = 16384` figure in the Verification paragraph above remains wrong at HEAD (live value 32768) — it is already flagged in the CORRECTION note in this record's closeout section and is repeated here so a reader arriving at the older paragraph is not misled. `implementation_status` stays `partial`: the ADR-051 deferred-distillation MCP tools are still not a discrete server, and no live call through :8084 was made by this pass. Commands: `git diff --name-only 89301ec7..HEAD -- agentbox.toml mcp/servers/lib/ontology-retrieval.js`, `grep -n 'loom_url\|loom_model\|loom_max_tokens' agentbox.toml`, `grep -n 'LOOM_FACADE_URL' mcp/servers/lib/ontology-retrieval.js`.

## Closeout extension — 2026-09-04

**Work package:** CP-03, grounded execution. **Accountable owner:** the existing
owner above, with the Loom maintainer responsible for served-bundle identity.
**Dependencies:** CP-01 consumer revision/feature map and CP-02 corpus exports.

The façade decision is implemented as a configuration boundary, but choosing
the same URL does not prove equivalent grounding. Agent retrieval uses search
and SPARQL, not Loom chat/scaffold. The current cache omits domain and token
override from its key: the actual helper returned an AI seed and 830 tokens for
a subsequent robotics request capped at 50 tokens. Expansion failure also
returned `degraded: false`. See [agent grounding evidence](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/agent-grounding-and-governance.md)
and [receipts](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/agent-snapshot.json).

**Remaining work:** preserve every effective request constraint on cache hits,
return stage-specific degradation, and distinguish requested provenance from
backend-enforced provenance. Bind retrieval to the generation actually loaded
by Loom. Define the behaviour of configured-but-unavailable Loom separately
from the existing unset-URL VisionClaw selection.

**Acceptance:** backend-selection, cache-hit, low-budget, domain-change,
expansion-failure and two-generation activation fixtures preserve the declared
contract or return an explicit limitation. Run these against the agent search/
SPARQL path as well as chat where applicable. Retain the partial implementation
status until the relevant evidence and deferred capability disposition are
recorded; current passing helper tests alone do not close CP-03.

## Acceptance progress — 2026-09-05

- **Implemented** (`mcp/servers/lib/ontology-retrieval.js`)
  - **Cache key completeness.** `cacheKey()` no longer hashes an implicit request shape. It
    hashes `field=value` pairs for every entry of the named `CACHE_KEY_FIELDS` constant —
    `query, model_tier, mode, depth, provenance, full, domain, max_tokens, budget (the resolved
    ceiling), min_maturity, backend, generation` — with a comment recording that an omitted
    field is a **correctness bug, not a perf tweak**. Absent/null/empty collapse to one
    sentinel so absence cannot alias a value. This closes the reproduced defect where an
    AI-domain 830-token body was served to a robotics request capped at 50 tokens.
  - **Stage-specific degradation.** Results carry `degraded_stages` drawn from
    `DEGRADED_STAGES` (`seed`, `expansion`, `sparql`, `backend-unavailable`) plus a named
    `DEGRADED_OUTCOMES` error. An expansion failure is now `degraded: true` with the stage
    named — previously `degraded: false`, which made a menu-only answer indistinguishable from
    a fully expanded one. `defaultExpandFn` / `loomExpandFn` tag thrown SPARQL errors with
    `stage: 'sparql'` so the sub-stage is nameable rather than inferred.
  - **Cache-hit semantics.** A hit replays the degradation state it was stored with (a partial
    answer stays partial) and is revalidated against the *current* request's constraints via
    `cacheEntrySatisfies()`. Documented policy on a violation: **miss and re-retrieve**, never
    truncate — the stored Turtle has already been clamped once, and a second deterministic cut
    would slice a seed mid-triple and silently change what the grounding asserts. A
    seed-stage transport failure is not cached, so an outage cannot pin an empty answer for
    the TTL.
  - **Configured-but-unavailable is a named outcome.** `selectBackend()` returns
    `{name, url, configured, generation, reason}`. An unset `LOOM_FACADE_URL` selects
    VisionClaw with reason `loom_facade_url_unset_visionclaw_selected` and is not a fault; a
    *configured* Loom that fails on availability/timeout returns
    `backend_configured_but_unavailable` with stages `[seed, backend-unavailable]`; an
    unconfigured backend returns `backend_not_configured`; a 401/validation rejection returns
    `seed_rejected` and is not treated as unavailability. Every result carries `backend`,
    `backend_configured` and `generation`, so one backend's answer can never be mistaken for
    another's.
  - The dependency-injection shape (`seedFn`/`expandFn`/`cache`/`clock`) is unchanged;
    `backend` and `generation` are new optional deps, and `getBackend()` exposes the selection.

- **Tests and results**
  - `node --test tests/integration/ontology-retrieval-cache.test.mjs` — **21 tests, 21 pass, 0
    fail** (hermetic, injected transports, no network). Fixtures: backend-selection (4),
    cache-hit preserving constraints (3), low budget after a high-budget hit for the same
    domain (1), domain change with identical other fields (1), expansion failure → stage-named
    degradation (3), two-generation activation (2), configured-but-unavailable Loom (5),
    cache-key completeness (2).
  - `node --test mcp/servers/lib/ontology-retrieval.test.js` — **20 tests, 20 pass, 0 fail**.
    One stale assertion in that pre-existing suite was updated: the expansion-failure case
    asserted `degraded: false`, which was the defect itself; it now asserts `degraded: true`
    with the stages named.

- **Receipts**
  - `docs/estate-closeout/2026-09-05/adr-2023-loom-cache.json` (source hashes, per-defect
    disposition, cache-hit policy rationale, fixture list, limitations).

- **Remaining**
  - Generation/bundle identity is honoured as an *input* (`deps.backend.generation`,
    `LOOM_GENERATION`, or a per-request pin) and keyed on, so two generations are two cache
    entries. Binding it to the generation the Loom has actually loaded needs a Loom-side
    identity surface that does not exist yet; today the value is asserted by configuration,
    not attested by the server.
  - The Loom expand helper still queries one merged graph and does not isolate asserted from
    inferred, so `provenance` remains a *requested* scope. Unchanged by this work, now visible
    alongside the backend name on every result.
  - Agent retrieval still uses `/loom/search` + `/loom/sparql`, not `/loom/scaffold` or chat;
    Loom's scaffold/chat benchmarks remain no evidence for this path. These fixtures are
    helper-level with injected transports and do not establish a live round-trip.
  - The ADR-051 deferred-distillation MCP surface is still not a discrete server.
  - `implementation_status` stays `partial` for those reasons.

- **Governed paths changed**
  - None. This is the client-side façade contract only: no manifest key, no authority class and
    no ingress boundary changed. `loom_url` / `loom_model` in `agentbox.toml` are untouched, and
    consumers still hold the `:8084` door. The observable change is the richer result shape
    (`degraded_stages`, `backend`, `backend_configured`, `generation`, `domain`, `budget`,
    `error`, `error_cause`) and the fact that a constraint-violating cache entry is no longer
    served.

### Re-verification 2026-09-05 (ADR-2023)

Verification ran on the **uncommitted working tree** above `89301ec7c911eab270c00a0cf81596d0d4f15535`.
`verified_commit` is set to that SHA and `verified_paths` emptied; **both must be
restored at the landing commit** — the prior list was
`[agentbox.toml, mcp/servers/lib/ontology-retrieval.js]`.

Each claim re-checked, with **two corrections**:

- **Façade URL — unchanged.** `agentbox.toml [dream_machine].loom_url` (`:1613`) is
  `http://192.168.2.132:8084/v1`, and `[skills.ontology.condense].endpoint` (`:649`)
  carries the same value with the comment "Ontology Loom façade (model-swap door; DNAT
  via ml). Was the dead .48 host."
- **CORRECTION — token cap.** This record's Verification said `loom_max_tokens = 16384`
  at `:1564-1566`. The live value is **32768** at `[dream_machine].loom_max_tokens`
  (`:1618`), raised after glm-5.3 exhausted the old cap and returned empty content twice.
  `loom_model = "qwen3.8-27B"` (`:1614`) is unchanged. Per ADR-2052 these are now cited
  by key rather than line.
- **CORRECTION — `opf-router` is not a Loom surface.** `docs/BASELINE-container.md`
  describes `opf-router` as an "OpenAI-compatible façade router" on `:8084`. It is the
  **privacy-filter redaction sidecar** (legacy ADR-008) on **9092**
  (`agentbox.toml [privacy_filter].port`, `scripts/opf-router.py:41`,
  `flake.nix` `[program:opf-router]`). **No agentbox program binds `:8084`** — the only
  two `8084` hits in `flake.nix` are outbound `LOOM_URL`/`LOOM_BASE_URL` client defaults.
  The Loom façade is a service on machinelearn reached over the LAN, not a supervised
  agentbox program. Recorded as ADR-2055; the BASELINE row edit is routed to its owner.
- **Retrieval resolves through the Loom when configured — unchanged and extended.**
  `mcp/servers/lib/ontology-retrieval.js:472` reads `LOOM_FACADE_URL` in `selectBackend`
  (`:471`), with the three documented outcomes at `:463-467`. The 2026-09-05 acceptance
  work is present: `CACHE_KEY_FIELDS` (`:46`) and `DEGRADED_STAGES` (`:93`).
- `implementation_status` stays **partial** on its own terms: the ADR-051
  deferred-distillation MCP surface is still not a discrete server.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: agentbox.toml: a new `[skills.podcast_ingest]` section (ADR-2057) only; every section this record governs is untouched. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: agentbox.toml. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.


## Bounded source re-verification — 2026-09-07

The retrieval source now verifies loaded Loom identity before cache and requires matching per-response headers.27 local retrieval tests pass. Older live Loom and mixed semantic/graph generations are explicitly rejected by the staged client; source implementation does not establish rollout. The complete intervening change to the governed source was reviewed at `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; prior runtime/approval limitations remain.

### 2026-09-07 documentation and workflow pin re-verification

The governed manifest diff at `7bf2382c031d696b0b2f5eb466f7e6615c88cc2c`
adds only two comments distinguishing the consultant wire alias from the documented
weight variant. The invariants workflow replaces action version tags with exact
commit pins and retains the same checks. Neither diff changes this decision’s
runtime behaviour; existing implementation and activation qualifications remain.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): agentbox.toml. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff 7bf2382c0..ee742ade5 -- <verified_paths>`; no re-implementation was needed.
