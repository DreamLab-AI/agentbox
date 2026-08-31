---
id: ADR-043
title: "Session identity binding: seven sovereign mechanisms at the AoE session boundary"
status: Proposed
date: 2026-08-04
type: contract
author: Dr John O'Hare
depends_on: [ADR-005, ADR-013, ADR-042]
related: [ADR-008, ADR-012, ADR-017, ADR-028, ADR-033, ADR-039, ADR-041]
review_trigger: AoE's `serve.rs` gains a native `AuthMode` that carries identity; a config hot-reload path lets `admin_access_mode` or `adapters.beads` flip without an image rebuild; the beads slot gains an `external` implementation that changes the session-lifecycle mapping; or the NIP-98 reverse proxy is replaced by AoE-native verification (relitigates the Alternatives section)
"@context": https://schema.org
"@type": TechArticle
---

# ADR-043 — Session Identity Binding at the AoE Session Boundary

**Status:** Proposed
**Date:** 2026-08-04
**Repo:** DreamLab-AI/agentbox
**Part of:** the interaction-surface consolidation sprint ([PRD-021](../prd/PRD-021-interaction-surface-consolidation.md)) — records decision **D4** in full.

**Related:** [ADR-042](ADR-042-agent-of-empires-interaction-plane.md) (adopts
Agent of Empires as the interaction plane — this ADR gives its sessions
identity), [ADR-044](ADR-044-voice-plane-aoe-repoint.md) (voice plane repoint —
consumes the same authed session records), [DDD-019](../ddd/DDD-019-interaction-plane-domain.md)
(the bounded context and invariants I01…), [ADR-013](ADR-013-canonical-uri-grammar.md)
(the URN grammar every session identifier is minted through), [ADR-017](ADR-017-multi-tenant-did-nostr-pods.md)
(multi-tenant pods — a superset kept gated off), [ADR-028](ADR-028-per-user-agent-fabric.md)
(the per-user agent fabric whose spawner this decision subsumes), [ADR-033](ADR-033-did-nostr-multikey-convergence.md)
(the `did:nostr` identity primitive each session binds), [ADR-039](ADR-039-docbox-backported-surfaces.md)
(the `live | boot | rebuild` apply-class taxonomy this ADR classifies its gates
against), [ADR-041](ADR-041-model-routing-one-policy-many-projections.md) (model
routing — untouched).

## TL;DR for newcomers

Agentbox has a complete sovereign-identity stack — a canonical URN/DID minter
(`lib/uris.js`), per-profile `did:nostr` derivation (`lib/agent-identity.js`),
NIP-98 HTTP auth (`middleware/auth.js`), a beads work-ledger adapter
(`adapters/beads/local-sqlite.js`), per-user memory namespacing
(`routes/memory.js`), scoped WAC mandates (`lib/mandate.js`), and an authority
gate (`lib/authority.js`). Almost none of it is *reached* by the running box:
the tmux/local path calls these libraries in-process without an authenticated
identity, and the manifest gates that would bind identity per session are flipped
off (`adapters.beads = "off"`, `admin_access_mode = "permissive"`). The
user-facing promise — "per user and per project IRI/URI, beads, auth, did:nostr,
namespaces" — is *built but not practised*.

Adopting Agent of Empires (AoE) as the interaction plane (ADR-042) creates a
single, well-defined **session boundary** — every interactive agent run is
created, claimed, and closed through one lifecycle. This ADR wires the seven
existing mechanisms onto that boundary. **It invents no new primitive.** Two of
the seven flips are `rebuild`-class (they are baked into the Nix image), so they
land in the sprint's flake/manifest pass, not a live toggle. The net effect: each
AoE session carries a distinct `did:nostr`, a canonical URN, a beads epic, an
isolated per-project memory namespace, an optional scoped mandate, and reaches
the box only through a NIP-98-verifying reverse proxy.

## Context

The sovereign-identity spec surface is real code, audited file-by-file in the
sprint's identity-gap investigation (`mesh-identityGap.md`). The gap is not
absent implementation — it is **unreached** implementation. The following table
is the condensed promised-vs-practised backbone; each row is a mechanism this
decision binds, its built state, why it is dormant, and the wiring the session
boundary needs.

| Mechanism | Built (evidence) | Dormant because | Session boundary needs |
|---|---|---|---|
| **URN mint per session** | `lib/uris.js` mints `urn:agentbox:<kind>:[<scope>:]<local>` across 18 kinds (`uris.js:87-109`); `mint()` enforces content-addressing and pubkey scope (`uris.js:154-184`) | No caller in the session-spawn path mints one; tmux windows have no URN | Mint `urn:agentbox:activity:<scope>:session-<sha256-12>` at session-create via `uris.mint({ kind:'activity', … })`; stamp on the session record |
| **`did:nostr` per session** | `lib/agent-identity.js` `loadOrMint()` derives a real BIP-340 keypair per profile, persists 0600 (`agent-identity.js:107-160`) | Practised as one profile (`default`) → one DID for the whole box | Set `AGENTBOX_PROFILE=<session-slug>` per spawned session so each derives a distinct persisted DID |
| **Beads work-ledger** | `adapters/beads/local-sqlite.js` `createEpic/createChild/claim/close`, each id `uris.mint({kind:'bead'…})` (`local-sqlite.js:78-235`) | `adapters.beads = "off"` (`agentbox.toml:12`); no `/v1/beads` route mounted | Flip to `local-sqlite`, add `routes/beads.js`, map session lifecycle → epic/child/claim/close |
| **Per-project memory namespace** | `routes/memory.js` `_effectiveNamespace()` prefixes NIP-98 callers to `user:<pubkey>:<ns>` (`memory.js:60-73`) | `admin_access_mode = "permissive"` (`agentbox.toml:316`) → bearer admin ungated; scoping only fires for NIP-98 callers, of which the tmux path has none; and there is no *project* axis | Namespace grammar `user:<pubkey>:proj:<repo-slug>:<ns>`; flip `admin_access_mode` to `"scoped"` |
| **Scoped mandate (WAC)** | `lib/mandate.js` `createMandate/mandateToAclTurtle/signMandate` complete (`mandate.js:99-180`) | No REST route wires it; consumed only on the pods ACL PUT path | Mount `/v1/mandate` (create/revoke); optionally mint a per-session mandate binding the session DID to its worktree/pod |
| **NIP-98 HTTP auth** | `middleware/auth.js` hybrid bearer+Nostr, global `onRequest` hook (`server.js:181-233`); already the default on agent-events emit, pod-git, and pods-adapter egress | AoE `serve.rs` `AuthMode` stops at Token/Passphrase/None — no identity on the AoE surface | A NIP-98-verifying reverse proxy is the *sole* ingress to `:9095`; AoE runs `--auth none --behind-proxy` on loopback |
| **Authority gate** | `lib/authority.js` `buildAuthorityGate()`, classification table populated (`authority.js:99-163`; classes at `agentbox.toml:684-720`) | Enabled but fail-closed without an `awaitDecision` consumer → every zero-tolerance action **DENIED** | Wire a local `awaitDecision` consumer (embedded relay or dashboard approval prompt) so zero-tolerance actions can be *released* |

Three facts anchor the design. First, **NIP-98 already bites on three of the four
identity-bearing HTTP surfaces** (agent-events emit, pod-git smart-HTTP, and the
pods-adapter egress under `solid_pod_rs`); the pattern to copy into the AoE
ingress already runs in-box. Second, **AoE has a mature session manager but no
identity** — `serve.rs`'s only gate is an opaque random URL token that carries no
user, no DID, no pubkey, no namespace. Third, the clean division of labour is
therefore **AoE owns the session lifecycle; agentbox's `lib/uris.js`,
`lib/agent-identity.js`, `routes/memory.js`, and `adapters/beads` supply
identity and ledger** — called at the boundary, never re-implemented in the fork
(ADR-042 D2, overlay-only, zero `src/` patches).

## Decision (D4)

Bind seven mechanisms at the AoE session boundary. Each is existing agentbox
code; the sprint wires it, it does not invent it.

### D4.1 — Per-session `did:nostr` via `AGENTBOX_PROFILE`

Each AoE session spawns with `AGENTBOX_PROFILE=<session-slug>` in its
environment. `lib/agent-identity.js` `loadOrMint()` keys its persisted key-file
on the profile (`profileKeyPath(opts)`, `agent-identity.js:108`), so a distinct
profile yields a distinct, persisted BIP-340 keypair written 0600 to
`/var/lib/agentbox/identities/agent-did-<profile>.key` (`agent-identity.js:139-145`).
The returned `{ did: 'did:nostr:<xOnly>', pubkey, multikey }`
(`agent-identity.js:150-158`) is the session identity: the same even-y x-only hex
primitive fixed by ADR-033 (I1). `loadOrMint()` fails open to a run-scoped DID if
persistence fails (`agent-identity.js:143-147`) — never fatal, never leaks the
private key. An explicit `AGENTBOX_AGENT_PRIVKEY_HEX` still overrides
(`agent-identity.js:114-117`) for deterministic test sessions. **No key bytes
change; this is profile selection, not a new key scheme.**

### D4.2 — Per-session URN minted at session-create via `lib/uris.js`

At session-create a thin shim (AoE session-lifecycle hook → management-api) calls
`uris.mint({ kind: 'activity', pubkey: <session-did>, payload: { … } })`. The
`activity` kind is owner-scoped and content-addressed (`uris.js:100`), so the
mint enforces the session DID as `<scope>` and derives the local part as a
`sha256-12` content address — producing `urn:agentbox:activity:<scope>:session-<sha256-12>`.
The URN is stamped on the session record and, per the gap analysis, on every WS
frame the session emits. **Ad-hoc URN construction stays prohibited (ADR-013);
`format!()`/template-literal URNs are a contract violation.** We deliberately
reuse the `activity` kind rather than mint a new one — see Alternatives.

### D4.3 — Beads work-ledger ON, with a session-lifecycle mapping

Flip `adapters.beads = "local-sqlite"` (currently `"off"`, `agentbox.toml:12`)
and mount a new `routes/beads.js` HTTP surface (it does not exist today; the
adapter is complete but routeless). Map the AoE lifecycle onto the adapter's
verbs (`local-sqlite.js:78-235`):

- **session create → `createEpic`** — one epic per session; its bead id is minted
  `uris.mint({ kind:'bead', pubkey, payload:{ type:'epic', … } })` (`local-sqlite.js:85`).
- **task / turn units → `createChild` + `claim`** — each unit of work becomes a
  child bead (`local-sqlite.js:121`) claimed by the session actor; `claim` is
  idempotent — re-claim by the same actor is a no-op (`local-sqlite.js:145-157`).
- **session end → `close`** — the epic closes with an outcome (`local-sqlite.js:168`).

Bead URNs are already minted by the adapter, so the ledger is URN-addressable and
crosses the BC20 bridge structurally (the `bead` kind is content-addressed to
match VisionClaw's converged grammar, `uris.js:104-109`). The result is a durable,
per-session, URN-stamped work ledger where the running box has none.

### D4.4 — Per-project memory namespaces + scoped `admin_access_mode`

Sessions read and write memory under the grammar
`user:<pubkey>:proj:<repo-slug>:<ns>` — the existing per-user prefix
(`memory.js:60-63`) extended with a **project axis** (the running scoping is
per-user only; it has no project dimension). To make the isolation real, flip
`[memory].admin_access_mode` from `"permissive"` to `"scoped"`
(`agentbox.toml:316`). In `"scoped"` mode `_effectiveNamespace()` prefixes *every*
caller — including bearer admin — to a pubkey-scoped namespace
(`memory.js:66-70`), so one AoE session cannot read another's memory. The
operator retains a **documented break-glass path**: in `"scoped"` mode the bearer
admin is mapped to the operator's own pubkey namespace
(`AGENTBOX_X_ONLY_PUBKEY_HEX` / `AGENTBOX_PUBKEY`, `memory.js:67-69`), and
cross-session inspection is available only by presenting that operator identity —
an explicit, auditable elevation, not the current silent ungated read.

### D4.5 — Mandates: mount `/v1/mandate` over `lib/mandate.js`

Mount a `/v1/mandate` REST surface (create/revoke) over the complete-but-unwired
mandate library. `createMandate()` mints a `urn:agentbox:mandate` scoped to the
issuer pubkey (`mandate.js:99`); `mandateToAclTurtle()` renders the WAC fragment
granting `acl:agent <did:nostr:AGENT>` (`mandate.js:137`); `signMandate()` wraps
it as a signed, revocable kind-30078 replaceable event (`mandate.js:163-180`).
**Mandate scope (operator decision 2026-08-04, resolving DDD-019 OQ3): lazy.**
A session's mandate is minted **on its first pod write**, not at session create —
the shim's mint-if-absent path scopes it to the container being written and the
write then proceeds. Worktree-only sessions (the majority) never mint one, so
every mandate that exists was actually used and the ledger stays meaningful.
Session seeds carry an `eager_mandate = true` flag for the few sessions known to
be pod-writers, degrading lazy into eager per-seed rather than globally. Either
way the session writes under its **own** DID without ever holding the operator's
nsec. This is the delegation half of the sovereign promise: least-privilege,
revocable, WAC-expressed.

### D4.6 — NIP-98 reverse proxy as the SOLE ingress to `:9095`

AoE `serve` binds loopback with `--auth none --behind-proxy --host 127.0.0.1
--port 9095` (ADR-042 D3). The **only** thing permitted to reach `:9095` is a
NIP-98-verifying reverse proxy (an extension of the existing `https-bridge` or a
sibling thin proxy) reusing `middleware/auth.js`'s `verifyNip98Header`
verification and forwarding with `X-Forwarded-For`. The verified pubkey becomes
the session's authed identity. **Invariant: nothing else may reach `:9095`** —
not another process, not another host, not the operator's browser directly. This
mirrors the pattern already live on agent-events emit, pod-git, and pods-adapter
egress, and closes AoE's identity-free token gap without patching the fork.
Native NIP-98 *inside* AoE is explicitly rejected (see Alternatives).

### D4.7 — Local `awaitDecision` consumer for the authority gate

Wire a local `awaitDecision` consumer so the authority gate can *release*
zero-tolerance actions instead of universally denying them. `buildAuthorityGate()`
consumes an optional `deps.awaitDecision(signedRequest, {timeoutMs}) =>
Promise<signedResponse|null>` (`authority.js:125`); without a consumer a
zero-tolerance action has no channel to receive an approval and is **DENIED —
never released** (`authority.js:21-32,163`). **Consumer shape (operator decision
2026-08-04, resolving DDD-019 OQ4): both, layered — the relay is canonical, the
dashboard is a signing front-end.** The gate publishes the kind-31402
ActionRequest to the embedded relay and awaits a Schnorr-signed kind-31403
decision from an allowlisted key; the operator can answer from the existing
mobile path (Amethyst/Amber holds a delegated allowlisted key) **or** from a
pending-approvals surface in the dashboard that, on click, signs and publishes a
31403 (NIP-98-authed request → operator delegation key; NIP-46 remote signing is
the upgrade path). A plain unsigned HTTP approval is prohibited — the decision
record is always a signed event, so the audit model survives whichever front
door answers. This turns the gate from a blanket denier into a functioning
approval loop while preserving fail-closed semantics: an *un-answered* or
*unverified* decision still denies.

### Apply classes (ADR-039 taxonomy)

Per ADR-039 D1, each gate carries a hand-assigned `live | boot | rebuild` apply
class, and each new gate earns an honest `system-manifest.js` catalogue entry:

| Mechanism | Gate | Apply class | Why |
|---|---|---|---|
| D4.3 beads slot | `adapters.beads` | **`rebuild`** | Adapter selection is resolved at Nix image composition; flipping it needs `./agentbox.sh rebuild` + container recreate |
| D4.4 memory scoping | `[memory].admin_access_mode` | **`rebuild`** | Baked to `MEMORY_ADMIN_ACCESS_MODE` at Nix build time (`agentbox.toml:298-316`); changing it requires `nix build` + recreate |
| D4.1 per-session DID | `AGENTBOX_PROFILE` per session | `boot`/runtime | Set per spawned session by the seed/spawn path; no image change |
| D4.2 URN mint | session-create shim | `boot` | Route/shim reconciled at boot |
| D4.5 `/v1/mandate` | route mount | `boot` | New management-api route |
| D4.6 NIP-98 proxy | proxy program + `[interaction_plane].proxy_auth` | `boot` | Supervisor block + config reconciled at boot |
| D4.7 authority consumer | `deps.awaitDecision` wiring | `boot` | Wired at management-api boot |

The two **`rebuild`-class** flips (beads, `admin_access_mode`) are the load-bearing
scheduling constraint: they cannot be toggled on a running box, so they land in
the sprint's flake/manifest pass (WS3) alongside the image rebuild — never as a
post-hoc live switch. This is called out as a sprint risk in PRD-021 §Risks.

## Hard invariants

- **I01.** No AoE session exists without a bound `did:nostr` (D4.1). Fail-open
  yields a run-scoped DID, never *no* DID.
- **I02.** Every durable session identifier is minted through `lib/uris.js`
  (D4.2). Ad-hoc `format!()`/template-literal URNs are prohibited (ADR-013).
- **I03.** The NIP-98 reverse proxy is the **sole** ingress to `:9095` (D4.6).
  AoE binds loopback with `--auth none`; loopback + proxy-only is the trust
  boundary.
- **I04.** In `"scoped"` memory mode no session reads another session's namespace
  (D4.4); cross-session inspection requires an explicit operator break-glass
  identity, and that access is auditable.
- **I05.** The authority gate stays fail-closed: an un-answered or unverified
  zero-tolerance decision denies (D4.7); the consumer only adds a *release* path
  for verified approvals.
- **I06.** Identity is unchanged from ADR-033 — the BIP-340 x-only even-y hex
  pubkey; this ADR adds no key scheme, migration, or npub/URN churn.

## Alternatives considered and rejected

### Native NIP-98 inside AoE `auth.rs` — REJECTED

Adding `AuthMode::Nip98` to AoE's `serve.rs` (hooking the `TokenSource` enum at
`auth.rs:465`) would put identity verification *inside* the fork. Rejected on the
overlay-only principle (ADR-042 D2): upstream AoE is hot (multiple PRs/day), so
any `src/` patch is a permanent rebase treadmill, and NIP-98 verification would
duplicate `middleware/auth.js` in Rust with a second implementation to keep in
lock-step. The reverse proxy (D4.6) achieves identical identity binding with zero
fork patches and reuses the exact verification already live on three surfaces.
The `TokenSource` hook point is recorded only as the seam to revisit if the
overlay model is ever abandoned.

### Keep memory `permissive` — REJECTED

Leaving `admin_access_mode = "permissive"` would let every AoE session, running as
the one `devuser` bearer identity, read and write *all* namespaces unprefixed
(`memory.js:66-70`) — no per-session, per-project, or per-user isolation whatever.
That directly contradicts the "per project namespaces" promise D4 exists to
honour. Rejected; the sprint flips to `"scoped"` (a `rebuild`-class change,
scheduled into the flake pass) with an explicit operator break-glass path so
legitimate cross-session inspection stays possible but auditable.

### Invent a new URN kind for sessions — REJECTED

A `session` kind in `uris.js`'s `KINDS` table was considered and rejected in
favour of **reusing the existing `activity` kind** (`uris.js:100`). ADR-013's
grammar is deliberately closed at 18 kinds; a session is a PROV-O *Activity* (it
has a start, an actor, and an end), so it is exactly what `activity` already
models. The precedent is settled: the Code-as-Harness layer already maps
`ExecutionTrace → urn:agentbox:activity:<scope>:trace-<id>` and
`ProjectScan → urn:agentbox:activity:<scope>:projscan-<sha256-12>` without
minting a bespoke kind (`docs/reference/claude-context/subsystem-notes.md`
§Code-as-Harness). A new kind would fork the grammar, break the BC20 bridge's
kind-mapping table, and gain nothing a scoped `session-` local part does not
already give. Sessions join the `did:nostr` identity mesh as *activities*, not as
a new primitive.

## Consequences

### Positive

- The sovereign promise becomes *practised*, not merely *built*: every session is
  resolvable via `/v1/uri`, writes a beads ledger, and is isolated to its own
  memory namespace — the measurable success criteria PRD-021 tracks.
- Zero fork patches: all seven mechanisms are agentbox-side wiring of existing
  code, honouring ADR-042's overlay-only constraint.
- The NIP-98 pattern already proven on three surfaces now covers the interaction
  plane, unifying the box on one auth model.
- Least-privilege delegation (D4.5) and a functioning authority approval loop
  (D4.7) close two capabilities that were complete in library form and dead in
  practice.

### Negative

- **Two `rebuild`-class flips** (beads, `admin_access_mode`) mean the identity
  binding cannot be delivered by a live toggle — it is coupled to an image
  rebuild and container recreate, and mis-sequencing it against the runtime
  session seeds is a sprint risk (PRD-021 §Risks).
- Flipping memory to `"scoped"` breaks the current frictionless cross-agent admin
  inspection; the break-glass path (D4.4) restores it but now demands an explicit
  operator identity — a deliberate friction cost.
- The reverse proxy becomes a hard dependency and a single point of failure for
  *all* AoE ingress; if it is down, `:9095` is unreachable (by I03 design, it must
  be).

### Neutral — ADR-028's PUAF spawner is subsumed

The Per-User Agent Fabric (ADR-028) and AoE's session manager solve the same
problem from opposite ends: ADR-028 has the identity/memory/URN sourcing but a
**dormant** spawner (`[sovereign_mesh].per_user_agents = false`); AoE has a
**mature** spawner and dashboard but no identity. Under this consolidation **AoE
owns the session lifecycle (the spawner) and ADR-028's spawning role is
subsumed** — `lib/per-user-agent.js`'s relay-triggered spawn is superseded by AoE
session-create. What is **retained** from ADR-028 is precisely its identity and
memory *sourcing* contribution: pod-sourced identity (SOUL.md/USER.md) and
`user:<pubkey>:agent` memory recall feed the same D4.1/D4.4 boundary. ADR-028 is
not withdrawn; its spawner overlaps AoE and yields, its identity-sourcing lives
on. Multi-tenant pods (ADR-017) remain a gated-off *superset* — needed only if
AoE hosts more than one human; per-session DIDs already cover single-operator,
multi-session isolation.

## References

- PRD-021 — Interaction-Surface Consolidation (the sprint; D4 is this ADR)
- ADR-042 — Agent of Empires interaction plane (overlay-only; D2 rejects fork patches)
- ADR-044 — Voice plane AoE repoint (consumes authed session records)
- DDD-019 — Interaction Plane bounded context (invariants I01…)
- ADR-013 — Canonical URI grammar (`lib/uris.js`, the 18-kind closed grammar)
- ADR-017 — Multi-tenant `did:nostr` pods (gated-off superset)
- ADR-028 — Per-User Agent Fabric (spawner subsumed; identity sourcing retained)
- ADR-033 — `did:nostr` Multikey convergence (the identity primitive each session binds)
- ADR-039 — Apply-class taxonomy (`live | boot | rebuild`) and `system-manifest.js`
- `management-api/lib/uris.js`, `lib/agent-identity.js`, `lib/mandate.js`, `lib/authority.js`
- `management-api/adapters/beads/local-sqlite.js`, `routes/memory.js`, `middleware/auth.js`
- `docs/reference/claude-context/subsystem-notes.md` §Code-as-Harness (the activity-kind reuse precedent)
