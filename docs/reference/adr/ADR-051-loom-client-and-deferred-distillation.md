---
id: ADR-051
title: Loom client and deferred distillation — harness-side integration for the Ontology Loom
status: proposed
date: 2026-08-11
type: integration
adr_category: architecture
author: Dr John O'Hare
depends_on: [ADR-013, ADR-005, ADR-048, ADR-049, ADR-050, ADR-075, ADR-090, ADR-112, ADR-113, ADR-116, ADR-119]
prd: [PRD-020, PRD-022]
domain: DDD-020
policy_decided: 2026-08-11 — direct-to-target dev/test build (operator: NOT staged live-migration); Phase-1 loop = submit/await/fetch + beads migration + reaper/janitor/heartbeat
review_trigger: a second distillation provider lands (the N=1→platform threshold), or the Loom façade contract (VisionClaw ADR-135) changes its generation/index shape
---

# ADR-051 — Loom client and deferred distillation

> **Numbering:** re-checked next-free at draft — ADR-045…050 all landed (048–050
> 2026-08). ADR-051 is free; this doc claims it. If a concurrent branch has taken
> 051 at merge, renumber to the next free and update the cross-refs in the OCP
> capstone set (VisionClaw PRD-025 / ADR-135, this doc).
>
> **Scope boundary.** This ADR owns the **harness (agentbox) side** of the
> Ontology Loom capstone: agentbox as a *client* of the Loom façade, the
> consumer-side deferred-distillation MCP tools, and the beads adapter changes
> that make a distillation job a durable, fenced, content-addressed work item.
> The Loom node itself — its stable façade contract, corpus lifecycle, generation
> minting, reasoning authority, and GitHub write-back — is specified in
> **VisionClaw ADR-135 (Loom façade + lifecycle)** and **VisionClaw PRD-025**.
> Where those name a wire shape, this doc consumes it and does not redefine it.

## Context

The Ontology Loom (operator reframe, 2026-08-11) is a first-class VisionFlow node
that weaves the corpus into a reasoned ontology, holds it as canonical, and serves
it behind a stable, model-swappable façade. HP-Desktop is its reference deployment;
the role is host-portable and the distillation backend behind the façade is a config
line (`DISTILL_BACKEND_URL`), not an architecture decision. The estate is dev/test,
so per operator decision this integration is built **direct-to-target**: no staged
live-migration shims, no dual code paths. The target end-state is the design.

agentbox today holds two of the scattered, partly-duplicated pieces of ontology
intelligence the Loom consolidates (OCP §0b):

1. The **"one brain"** — `mcp/servers/lib/ontology-retrieval.js` (PRD-020 / ADR-112),
   an in-process retrieval library plus a synchronous PUSH breadcrumb generator
   `mcp/servers/lib/ontology-push.js`. The PUSH hook runs inside `UserPromptSubmit`,
   MUST be synchronous, `<15 ms`, and do **no network I/O** (ADR-112 §2.2). It reads
   a *local* pre-warmed Class-Summary cache
   (`.claude-flow/data/ontology-classes-cache.json`) and trigram-matches. The PULL
   library seeds from a RuVector HNSW index and expands via authed VisionClaw SPARQL.
   Both re-derive index state that the Loom now owns authoritatively.

2. The **beads** work-ledger (`management-api/adapters/beads/local-sqlite.js`,
   ADR-005 §beads slot) — the durable receipt store a deferred job must live in. Its
   current schema has no lease fencing, no typed result reference, an unconditional
   (TOCTOU-prone) `claim`, and a non-CAS `close`. That is insufficient for a job that
   is claimed by a remote provider, delivered out-of-band, and reconciled by a janitor.

The capstone loop the harness must close: an agent calls a tool mid-turn to submit a
distillation job, **keeps working**, and a later turn (or a bounded in-turn poll)
fetches a signed, sha-pinned, budget-clamped distilled summary to recombine with
search. No agent hand-rolls the six steps (canonicalise → mint URN → sign → bead →
rendezvous → verify), no agent touches a signing key, and **no consumer ever holds a
turn open on the LLM** (the no-synchronous-await law).

### Binding constraints (honoured verbatim; not re-litigated here)

- **ADR-112 one-brain / no hot-path LLM** — the PUSH hook stays synchronous, local,
  `<15 ms`, network-free; distillation is never on any hot path.
- **ADR-116 tier budgets** — every retrieval/fetch result passes `clampToBudget`; the
  await poll's own token cost is tier-budgeted.
- **write-path-never-widened** — this ADR adds no new corpus/`:summary` write
  credential; Phase-2 elevation reuses the existing governed door (D-precedent below).
- **fail-labelled, not fail-open** — a missing/unverified/expired distillate is
  delivered as a *labelled* failure the recombine step degrades on, never silently as
  ontology-grounded truth.
- **URI/DID grammar closed (ADR-013)** — bead and job URNs mint through
  `management-api/lib/uris.js`; `did:nostr:` wrapped; content-address is `sha256-12`.
- **corpus honesty** — every result carries `corpusNature:
  "synthetic-ai-generated-human-directed"`.
- **SPARQL `SERVICE` forbidden** — the PULL expander issues only local, clamped,
  k-hop queries against the Loom-published generation; no federated `SERVICE` clause.
- **ADR-090 ring order** — bead writes and RuVector writes obey the established
  side-effect ring ordering; close is the linearisation point (below).
- **RuVector MCP-only** — the rendezvous uses `mcp__claude-flow__memory_*`
  exclusively; CLI / raw SQL INSERT bypass the embedding pipeline and are forbidden.

## Decision

Adopt seven decisions (D1–D7). D1 makes the one brain a **thin client** of the Loom.
D2–D6 build the **deferred-distillation client**: the tools, the beads migration, the
RuVector rendezvous, the reconciliation, and the recombine ownership. D7 is liveness.

---

### D1 — The "one brain" becomes a thin client of the Loom's index generation

`ontology-retrieval.js` **stops being an independent index builder** and resolves its
authoritative index state **from a Loom generation**. This preserves ADR-112 exactly:
the Loom owns the *slow/authoritative* path (lifecycle, reasoning, index generation);
the in-process library keeps its *fast local* path but consumes, rather than
re-derives, the index.

- **PUSH (hot path) stays local and network-free.** The `UserPromptSubmit` hook still
  reads the local Class-Summary cache and does the `<15 ms` trigram match — **no
  network on the hook, ever.** What changes is the cache's *provenance*: the cache file
  is a **Loom-generation artifact** (a `scaffold-index`/`Class-Summary` slice keyed by
  the generation `corpusSha`), refreshed out-of-band by the WS-2 condensation step
  pulling the current Loom generation, never synthesised independently by the harness.
  The hook resolves *which* generation it is reading from the cache header; it does not
  fetch a generation on the hot path.
- **PULL (`ontology_ask`, consultant seam) resolves the authoritative index from the
  Loom.** The HNSW seed index and the k-hop expander read the Loom's published
  generation (via the live-lan façade for in-container agents), not a locally rebuilt
  index. `clampToBudget` and provenance tagging are unchanged (ADR-116).

**Coverage matrix (audited — never "all").** Which Loom surface a consumer resolves is
determined by where it runs:

| Consumer | Resolves index from | Latency class | On the hot path? |
|---|---|---|---|
| **agent harness** (in-container) | local cache (PUSH) = Loom-generation slice; live-lan façade (PULL) | ms (PUSH) / fast-lan (PULL) | PUSH yes → local only; PULL no |
| **cloud agent** (no LAN) | static-cloud replica generation (the published site the Loom publishes) | ms reads, stale-tolerant | no |
| **external tool** (HTTP) | static-cloud replica, or live-lan façade if on-LAN | ms / fast-lan | no |

The corpus changes slowly, so a cloud/offline consumer reading a stale published
generation is correct behaviour, not degradation — only *fresh distillation* pauses
when the live Loom host is down, and that path is deferred by design (D2).

---

### D2 — Consumer-side deferred-distillation tools on the `ontology-bridge` MCP

Add three tools to `mcp/servers/ontology-bridge.js` (which already registers
`ontology_ask`, `kg_*`, etc.) so **no agent hand-rolls the pipeline and no individual
agent ever touches a signing key**. This is OCP WS-J — Phase 1, same weight as the
provider (WS-E); without it the loop does not close for a real agent.

**`ontology_distill_submit`**
```jsonc
// request
{ "scope":      { "slugs": ["gpu-flock","lease-epoch"] },  // OR { "domain": "..."} OR { "question": "..." }
  "question":   "How do lease-epoch fencing and the GPU flock interact?",
  "budget_tokens": 1200,
  "deadline":   "2026-08-11T14:30:00Z",
  "model_policy": "any-serving",          // or "pinned:<model-id>"
  "corpusSha_match": "at_least" }         // exact | at_least | latest
// response
{ "jobUrn": "urn:agentbox:job:<harness-pubkey>:sha256-12-<hex>", "beadId": "urn:agentbox:bead:...", "deduped": false }
```
Steps the tool performs, in order:

1. **Build the identity core** and canonicalise it with **RFC 8785 JCS** (named so the
   harness and the HP provider derive byte-identical bytes). The identity core is
   **only**:
   `{ kind:"ontology.distill", corpusSha, scope:{ slugs sorted+deduped | domain | question-normalised }, budget_tokens }`.
   `budget_tokens` **is** content — it changes the answer — and is hashed. Execution
   fields (`deadline`, `requester`, `sig`, result rendezvous, `model_policy`) are **not**
   hashed. `corpusSha` is resolved from the current Loom generation the harness is
   pinned to; `corpusSha_match` is an *execution* directive carried on the bead, not in
   the hash.
2. **Mint the job URN** via `uris.mint({ kind:'job', pubkey:<harness>, payload:<identity-core> })`
   → `urn:agentbox:job:<pubkey>:sha256-12-<hex>` (D3 adds the `job` kind). The mint's
   content-address for the `job` kind uses the **RFC 8785 JCS** serialisation of the
   identity core, not the loose `_stableStringify` the existing content-addressed kinds
   use — see D3 for why this is a per-kind canonical-form registration, not a global
   change.
3. **Sign the request envelope with the harness machine key** (BIP-340). Individual
   agents never see the key; the tool signs on their behalf. The signature binds the
   job URN, `corpusSha`, `scope`, `budget_tokens`, `deadline`, and the designated
   provider pubkey. This envelope is what the strict-nip98 provider door (VisionClaw
   WS-D) authenticates.
4. **Create two beads** (D3): a `distill` bead (work-ledger, minted normally,
   nonce-carrying) that **carries the job URN in a typed `job_urn` field**, and a
   `recombine` bead **blocked-by** the distill bead (`addDependency(recombine, distill)`).
5. **Dedupe-on-create.** The unique index on `job_urn` (D3) makes an identical
   resubmission resolve to the **same** distill bead and job URN; the tool returns
   `deduped:true` and does not re-sign or re-enqueue. The job URN is the idempotency +
   provenance anchor.

**`ontology_distill_await({ jobUrn, deadline })`** — deadline-bounded poll for
mid-workflow use. It polls the rendezvous (D4) *across the caller-supplied deadline*
and returns whatever has landed, or a **labelled timeout**. It **never exceeds the
no-synchronous-await law**: it does not hold a turn open on the LLM; it polls a
rendezvous that a *separate* provider fills, and the deadline is a hard ceiling. Its own
poll loop is tier-budgeted (ADR-116).

**`ontology_distill_fetch({ jobUrn })`** — budget-clamped retrieval of the delivered
result. Reads `namespace='ontology-distilled', key=jobUrn`, **verifies the provider's
BIP-340 result-envelope signature against the distiller-provider allowlist** (D4)
**before** `clampToBudget`, reconciles envelope fields (`jobUrn`/`corpusSha`/
`scaffold_engaged`) against the submitted job, and returns the clamped summary with its
derivation labels and `corpusNature`. On miss / unverified / field-mismatch it returns
**fail-labelled** (never fabricated ontology grounding).

**Two consumption modes, stated explicitly.**
- **fire-and-collect-later** (default, cross-session): `submit` in turn N; a later turn
  (or the recombine worker, D6) `fetch`es. This is the honest default for a 10 s–10 min
  distillation.
- **deadline-bounded await** (mid-workflow): `submit` then `await({deadline})` within a
  bounded window; degrade to search-only on labelled timeout.

**No-synchronous-await LAW (restated as a harness invariant).** Distillation is
submit-in-turn-N, recombine-in-a-later-turn-or-worker. No consumer holds a turn open on
a distill job, ever. Fast-wake (Phase 2) only *schedules* the recombine worker; it is
never a blocking accelerator.

---

### D3 — Beads adapter changes (the real work: schema migration + contract tests)

This is **not** a "~20 line" patch. It is a versioned schema migration on
`management-api/adapters/beads/local-sqlite.js` plus a new URN kind, a resolver case,
and contract tests. Five parts:

**(a) New deterministic `job` URN kind (ADR-013 §6 extension API).** Add to
`uris.js` `KINDS`:
```js
job: { ownerScope: true, scopeRequired: true, contentAddressed: true,
       resolvableSurface: 'jobs', canonicalForm: 'rfc8785-jcs' },
```
`_contentAddress` gains a per-kind `canonicalForm` switch: existing kinds keep the
legacy `_stableStringify` ("deterministic enough for a name"); **`job` uses RFC 8785
JCS** because the job URN is *both* a name *and* a cross-implementation idempotency
anchor the HP provider must reproduce byte-for-byte. Add the resolver `case 'job':` in
`routes/uri-resolver.js` (surface `jobs`) and a contract test asserting
`urn:agentbox:job:<pubkey>:sha256-12-<hex>` round-trips and that identical identity
cores from two independent serialisers collide. **Do not overload the `bead` kind** —
the distill bead is minted normally (nonce-carrying, so same-title beads within one ms
stay unique) and *carries* the job URN in a typed field. The bead and the job URN are
distinct: the bead is the work-ledger row; the job URN is idempotency + provenance.

**(b) Schema migration (versioned, with `PRAGMA user_version` gating and contract
tests).**
```sql
-- migration 002: distillation job support
ALTER TABLE beads ADD COLUMN lease_epoch  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beads ADD COLUMN job_urn      TEXT;      -- typed idempotency anchor
ALTER TABLE beads ADD COLUMN deadline     TEXT;      -- consumer deadline (execution field)
ALTER TABLE beads ADD COLUMN result_ns    TEXT;      -- typed result_ref.namespace
ALTER TABLE beads ADD COLUMN result_key   TEXT;      -- typed result_ref.key (= jobUrn)
ALTER TABLE beads ADD COLUMN result_sha   TEXT;      -- typed result_ref.content_sha
CREATE UNIQUE INDEX IF NOT EXISTS ux_beads_job_urn ON beads(job_urn) WHERE job_urn IS NOT NULL;
```
The unique partial index is what makes **dedupe-on-create** (D2 step 5) structural, not
advisory. `result_ref` is the typed triple `{ namespace, key, content_sha }` — the
recombine worker dereferences it (D6) only after reading the blocker's outcome.

**(c) `lease_epoch` fencing.** A monotonic epoch, incremented on **every** claim and
reclaim, carried in the result envelope and checked by both delivery sinks (D4 read,
D3 close). It makes a stale claimant's late delivery a no-op.

**(d) Conditional claim (replace the TOCTOU `claim`).** The current `claim` does
`SELECT` then unconditional `UPDATE`. Replace with a single CAS that also bumps the
epoch:
```sql
UPDATE beads SET actor=@actor, status='claimed', lease_epoch=lease_epoch+1, updated_at=@now
WHERE id=@id AND actor IS NULL;
```
`this.changes === 0` → `AlreadyClaimed` (someone won the race). Re-claim by the same
actor stays idempotent (guarded before the CAS). The janitor's **reclaim** is the same
pattern gated on a lease-TTL cutoff:
```sql
UPDATE beads SET actor=NULL, status='open', lease_epoch=lease_epoch+1, updated_at=@now
WHERE id=@id AND status='claimed' AND updated_at < @lease_cutoff;
```

**(e) CAS close carrying the typed `result_ref`.** The current `close` is an
unconditional `UPDATE`. Replace with a fenced CAS — **close is the linearisation
point** (ADR-090 ring order):
```sql
UPDATE beads
   SET status='closed',
       tags=json_set(COALESCE(tags,'{}'),'$.outcome',@outcome),
       result_ns=@ns, result_key=@key, result_sha=@sha, updated_at=@now
 WHERE id=@id AND status='claimed' AND actor=@actor AND lease_epoch=@epoch;
```
Returns changes-count; a failed CAS (stale epoch, wrong actor, already-closed) is a
no-op, never a clobber. Invariant, jointly with D4's write-before-close ordering:
**"closed-done ⇒ payload retrievable at `jobUrn`"**, and its dual —
**"closed-done-with-no-payload" is structurally impossible.**

`getReady` stays outcome-agnostic on purpose: a *failed* distill still unblocks its
recombine (the recombine must proceed search-only). What is **not** blind is the
recombine *worker* (D6), which reads the blocker's `outcome` before dereferencing
`result_ref`.

---

### D4 — RuVector rendezvous conventions (namespace `ontology-distilled`)

The Phase-1 load-bearing delivery path is **(a) RuVector payload + (c) bead close**,
strictly ordered, close last (OCP §Delivery). HP has no MCP, so the **harness-side**
result-upload handler (fed by the VisionClaw WS-D provider door's result-upload verb)
does the `memory_store` on receipt.

- **Namespace `ontology-distilled`, key `= jobUrn`.** The **typed-metadata gate is
  REQUIRED** for this namespace — a plain `memory_store` without the typed envelope
  metadata (jobUrn, corpusSha, provider pubkey, content-sha, lease_epoch) is rejected.
- **RuVector MCP-only.** Written via `mcp__claude-flow__memory_store` only; CLI / raw
  SQL bypass the bge embedding pipeline and are forbidden (rows would be invisible to
  HNSW read).
- **TTL law:** `TTL ≥ consumer_deadline + lease_TTL × max_redeliveries + sweep_period +
  slack`, clock starting **at delivery**. This guarantees the payload outlives every
  reconciliation window (D5) so the close-tail can always complete from the store.
- **First-write-wins on content sha.** An existing key whose stored result sha differs
  from an incoming one is **rejected + divergence-logged**, never upserted. Identical
  content is an idempotent no-op.
- **Sig-verify at read, before `clampToBudget`.** `ontology_distill_fetch` (D2) and the
  Phase-2 recombine read both verify the provider's BIP-340 envelope signature against
  the **distiller-provider allowlist** — a scoped, per-provider list, **not** generic
  `power_user`. Generic power_user must NOT suffice. Unverified → fail-labelled
  quarantine; the payload never crosses `clampToBudget`.
- **Distiller-allowlist stamp for revocation.** Each stored entry records the provider
  pubkey and the capability grant id so a **per-request revocation sweep** can
  invalidate deliveries from a compromised key without redeploy (mirrors the HP-key
  per-request revocation list).
- **Canary namespace `ontology-canary`** (D7): the liveness canary lands here, never in
  `ontology-distilled`, never writes `:summary`, is excluded from queue-depth and
  elevation metrics.

---

### D5 — Reconciliation janitor + deadline reaper (harness-side)

Both live harness-side and make "HP absence never blocks a turn" TRUE. The signed
result envelope is **courier-of-record**: it is self-contained and signed, so the sweep
can complete a tail from it alone.

**Reconciliation janitor** — one idempotent pass, period `P < min(lease_TTL,
memory_TTL) / 2`:

1. **Lease expiry:** `claimed` beads past `lease_TTL` → reclaim (D3d: increment epoch,
   clear actor, `status='open'`) → re-eligible.
2. **Tail completion:** OPEN distill beads whose `jobUrn` key **exists** in RuVector →
   complete the tail from the stored signed envelope: CAS-close `done` with the typed
   `result_ref` (and, in Phase 2, ensure the `:summary` write). The envelope's
   signature + sha-pins are the authority.
3. **Deadline expiry:** OPEN distill beads past `consumer_deadline` with **no** payload
   → CAS-close `expired` (D3e) → the outcome-aware recombine (D6) proceeds search-only.
4. **Divergence audit:** RuVector entries missing from `:summary` (Phase 2) re-posted
   before TTL.

**Deadline reaper** — at a job's deadline, CAS-closes the distill bead `expired` with a
cause split (`cause: unclaimed | claimed-not-delivered | gpu-contended |
model-unavailable | corpus-unavailable`), unblocking the recombine to proceed
search-only. This is the mechanism that makes the HP being down a *labelled* absence,
never a stalled turn.

---

### D6 — Recombine-worker ownership

Phase 1 consumption is **tool-side** (`ontology_distill_await` / `ontology_distill_fetch`);
the `recombine` bead is optional scaffolding. The **autonomous recombine worker** is a
Phase-2 workstream with a **named owner: `recombine-workerd`, a claude-flow daemon
consumer polling `getReady`**. It is the piece that makes "parallel workflows recombine"
real:

1. Poll `getReady()` (or `getReady({parent_id})`), filter to `recombine` beads.
2. For each ready recombine bead, **read every blocker's `outcome` first** (via
   `show(blockerId)` — the beads adapter surfaces `tags.outcome` and the typed
   `result_ref`). `getReady` returning a bead only means its blockers are *closed*, not
   *successful* (D3, correctness must-fix 4).
3. Branch on outcome:
   - `done` → dereference `result_ref` → `ontology_distill_fetch` (sig-verify + clamp) →
     recombine the distillate **with** the agent's own search results.
   - `expired | failed` → **propagate a labelled failure** into a search-only
     recombination. Never fabricate ontology grounding.
4. Close the recombine bead via the CAS path (D3e).

The worker never holds a turn on the LLM (D2 law); it consumes already-delivered,
already-fenced payloads.

---

### D7 — Liveness (ADR-119): heartbeat, not boot canary

- **jobd heartbeat staleness.** The HP `jobd` heartbeats every poll (short-TTL RuVector
  key / management-api provider-status). Liveness = **heartbeat-staleness threshold**,
  which kills the "green-but-zero" / ".48-is-dead" failure class. **Boot completion is
  NOT liveness.**
- **Periodic cap-exempt canary.** A canary job submitted at `T` with a harness-side
  landing deadline: not landed by `T + deadline` → alert. The canary is a **cap-exempt
  lane** (`canary:true`), lands in `ontology-canary` (D4), **never** writes `:summary`,
  **never** digests, and is **excluded** from elevation and queue-depth metrics.
- **Fail-labelled + cause-split telemetry** throughout: `scaffold_engaged=false` output
  is NEVER delivered as ontology-grounded (quarantined); every terminal state carries a
  cause (`gpu-contended | model-unavailable | corpus-unavailable | unclaimed |
  claimed-not-delivered`).

---

## Security posture (carried, not restated)

- **Sig-verify where trust is consumed** — provider BIP-340 result-envelope signature
  verified at the derived write door **and** at the RuVector read (fetch/recombine),
  against the **distiller-provider allowlist**, not generic `power_user`. Unsigned /
  unverifiable → fail-labelled quarantine on read; never crosses `clampToBudget`.
- **Harness request signing** — `submit` signs with the harness machine key; individual
  agents never touch keys. The key's at-rest custody mirrors the HP-key requirement
  (age/agenix-encrypted or hardware-held; per-request revocation, not env-at-boot).
- **Strict-nip98 provider door, drop Bearer** — the shared `MANAGEMENT_API_KEY` is a
  broadly-held LAN dev secret with no replay defence; the provider door (VisionClaw
  WS-D) is strict-nip98 and rejects Bearer. Claim lease binds to the claimant's verified
  pubkey; the delivering pubkey MUST equal the job's designated provider; bead close
  binds to job identity.
- **Release-build CI gate** — the LAN-facing VisionClaw binary must be a release build;
  a debug build reopens the `dev-session-token → power_user` fence. Gated in CI.
- **Phase-2 nostr** — job events use **NIP-59 gift-wrap** to hide plaintext scope from
  the relay (the content-addressed URN hides nothing on its own); NIP-26 delegation is
  retired in favour of per-consumer NIP-59 capabilities.
- **Write-path-never-widened** — nothing here grants a new corpus/`:summary` write
  credential.

## Durability / elevation — Phase 2 (pattern precedent only)

Significant distillates elevate to the corpus via **EnrichmentCandidate →
ElevationActor + `KnowledgeEnrichment` broker case (ACSP 31402/31403)** composed with
the **PRD-020 / ADR-121 WS-10 propose spine** → corpus → CI conflict gate → published
site. **agentbox ADR-050 (decision-elevation)** is cited **as pattern precedent only**
— for the *durability-through-resync* shape (a runtime artifact made durable by routing
it into the corpus so the sync re-derives it), **not** as the mechanism; the distillate
elevation reuses the class-elevation machinery (ElevationActor / `KnowledgeEnrichment`),
which is the `KnowledgeEnrichment` broker case, not the `DecisionElevation` variant
ADR-050 adds. Replay-before-accept is a hard gate on this path, or the replay claim is
dropped from the verification story (verification rests on sig + sha-pins; deterministic
replay is best-effort same-binary/same-weights only).

## Cross-repo hygiene (repo-qualified citations)

- **agentbox ADR-050 (decision-elevation)** vs **VisionClaw ADR-050 (pod-backed-kgnode)** —
  this doc cites the agentbox one, for durability precedent only.
- **agentbox PRD-022 (semantic-integrity-provenance-decisions)** vs **VisionClaw PRD-022
  (semantic-trust-layer)** — PROV-O routing (the reconciliation *mapping*, not a
  canonical graph) lands on the VisionClaw side; the harness consumes it.
- **agentbox ADR-049** owns `urn:agentbox:graph:provenance`; **VisionClaw PRD-022
  constraint 3** owns `urn:ngm:graph:provenance`. Neither is canonical; the distillate's
  PROV-O routes through the VisionClaw ProvenanceEmitter into `urn:ngm:graph:provenance`,
  reconciled to `urn:agentbox:graph:provenance` by the alignment mapping — the `/derived`
  fence writes summary quads **only**.
- **Phase-2 ACSP kinds:** allocate **NEW 31408 DistillJobRequest / 31409
  DistillJobResult** (via ADR-075 D1 new IS-Envelope kind `ontology.distill`). **Do NOT
  reuse 31406/31407** (SPARQL `semantic_query`) — those stay untouched. The harness is
  the client that emits 31408 / consumes 31409 on the Phase-2 nostr federation path
  (OCP WS-I), NIP-59-wrapped.

## Consequences

- The harness closes the capstone loop in Phase 1: `submit` mid-turn, keep working,
  `fetch` (or bounded `await`) a signed, sha-pinned, budget-clamped distillate to
  recombine with search — provenance provable from the signed envelope + Loom
  `build-manifest` sha.
- The one brain (ADR-112) is preserved *and* de-duplicated: it stops re-deriving an
  index the Loom now owns, without adding any network to the `<15 ms` hot path.
- The beads ledger gains lease fencing, CAS close, conditional claim, a typed
  `result_ref`, and a deterministic `job` URN kind — a fenced, content-addressed,
  reconcilable substrate for remote-delivered work, tested by contract.
- HP absence is a **labelled** absence: the reaper closes expired jobs with a cause and
  the recombine degrades search-only; no turn ever stalls on the LLM.
- Cost: a schema migration + contract-test surface, a signing key the harness must
  custody, and a janitor/reaper daemon the operator must enable. The RuVector TTL law
  and revocation stamp add bookkeeping on every delivery. All are correctness/security,
  not staging scaffolding — they hold in the direct-to-target end-state.

## Open decisions (for the operator)

1. **Recombine-worker home + cadence.** `recombine-workerd` as a claude-flow daemon
   consumer vs a dedicated service, and its poll period `P_recombine`. Recommendation:
   claude-flow daemon consumer, `P_recombine` = the janitor `P`; confirm at Phase-2 start.
2. **TTL-law parameters.** Concrete `lease_TTL`, `max_redeliveries`, `sweep_period`,
   `slack` feeding the D4 TTL law and the D5 janitor period `P`. These are estate-tuned;
   defaults must satisfy `P < min(lease_TTL, memory_TTL)/2`.
3. **`ontology_distill_await` exposure/gating.** Whether the bounded await is available
   to arbitrary agents or tier-gated (ADR-116), since the poll loop itself spends tokens.
4. **Harness machine-key custody.** age/agenix-encrypted vs hardware-held for the
   request-signing key, and the per-request revocation-list backing store.
5. **Canary cadence + landing-deadline threshold** for D7 (submission interval and the
   staleness/landing thresholds that trip the ADR-119 alert).
6. **Canonical reasoner (informational).** Which engine backs the Loom generation the
   harness consumes (VisionClaw Whelk EL++ promoted to the Loom vs `pipeline/reason.py`
   authoritative) is a **VisionClaw ADR-135** decision; the harness client is
   engine-agnostic and consumes whichever generation the Loom publishes. Recorded here
   so the client contract does not accidentally assume one.

## Implementation notes (for the build)

- `mcp/servers/ontology-bridge.js` — register `ontology_distill_submit` /
  `_await` / `_fetch` (D2).
- `management-api/lib/uris.js` — add the `job` kind + per-kind `canonicalForm`
  (`rfc8785-jcs`) in `_contentAddress`; `routes/uri-resolver.js` — `case 'job'`
  (surface `jobs`); contract tests for URN round-trip + cross-serialiser collision (D3a).
- `management-api/adapters/beads/local-sqlite.js` — migration 002 (`lease_epoch`,
  `job_urn` + unique partial index, `deadline`, `result_ns/key/sha`), conditional
  `claim` CAS, reclaim CAS, `close` CAS carrying `result_ref`; `management-api/routes/beads.js`
  surfaces the new fields (D3b–e). Contract tests: dedupe-on-create, claim race → single
  winner, close CAS no-op on stale epoch, reclaim increments epoch.
- `mcp/servers/lib/ontology-retrieval.js` / `ontology-push.js` — resolve index/cache
  from the Loom generation (header-tagged by `corpusSha`); no independent index build;
  hot-path hook stays local (D1).
- Harness-side result-upload handler → `mcp__claude-flow__memory_store`
  (`ns=ontology-distilled`, typed-metadata gate); sig-verify + allowlist + first-write-wins
  + revocation stamp (D4).
- `recombine-workerd` (claude-flow daemon consumer) — poll `getReady`, read blocker
  outcome, branch done/expired, CAS-close (D6). Reconciliation janitor + deadline reaper
  daemons (D5). jobd heartbeat-staleness monitor + cap-exempt canary (D7).
- Tests span the loop: a submitted job dedupes on resubmit; a claimed-then-late delivery
  is fenced out by epoch; a closed-done bead always has a retrievable payload; an expired
  job unblocks a search-only recombine; an unverified/unallowlisted delivery is
  quarantined before `clampToBudget`.
