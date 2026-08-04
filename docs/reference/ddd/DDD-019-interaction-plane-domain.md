# DDD-019: Interaction Plane Domain

**Date**: 2026-08-04
**Status**: Proposed
**Bounded Context**: Interaction Plane — Managed Agent Sessions
**Cross-references**: [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md) (product requirements — the consolidation sprint), [ADR-042](../adr/ADR-042-agent-of-empires-interaction-plane.md) (adopt Agent of Empires as the interaction plane, overlay-only), [ADR-043](../adr/ADR-043-session-identity-binding.md) (session-identity binding — the sovereign payload), [ADR-044](../adr/ADR-044-voice-plane-aoe-repoint.md) (voice-plane repoint), [DDD-003](./DDD-003-sovereign-messaging-domain.md) (nostr crypto, pod mailbox, kind-30840 digest — consumed, not owned), [DDD-005](./DDD-005-code-execution-domain.md) (URN-reuse precedent — Code-as-Harness), [DDD-010](./DDD-010-multi-harness-coordination-domain.md) (**partially superseded** — see §Migration), [DDD-016](./DDD-016-memory-learning-domain.md) (memory namespaces this domain scopes into), [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md) (beads + events adapter slots, observability middleware), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md) (URN grammar, `uris.js` minting), [ADR-017](../adr/ADR-017-multi-tenant-did-nostr-pods.md) / [ADR-028](../adr/ADR-028-per-user-agent-fabric.md) (identity fabric this domain draws on), [ADR-025](../adr/ADR-025-multi-harness-tmux-architecture.md) / [PRD-013](../prd/PRD-013-multi-harness-tmux-architecture.md) (**superseded** MAD tmux layout), [ADR-039](../adr/ADR-039-docbox-backported-surfaces.md) (apply-class honesty), [ADR-041](../adr/ADR-041-model-routing-one-policy-many-projections.md) (model routing — untouched)

---

## TL;DR for newcomers

*Skip if you already know the interaction-plane bounded context.*

This DDD captures the Interaction Plane bounded context: the part of the system that owns how an interactive agent session comes into being, gets a sovereign identity, records its work, and is driven and observed. The pain point is that the old MAD tmux layout (fifteen hand-built windows in one `agentbox` session, `config/tmux-autostart.sh`) grew a per-harness console UX, a bespoke worktree scheme, and a `harness-merge` helper that nothing outside the shell script understood, while the box's genuinely-built sovereign identity stack (`uris.js`, `agent-identity.js`, the beads adapter, scoped memory namespaces) sat un-wired to any of those windows — the promise of "per user and per project IRI/URI, beads, auth, did:nostr, namespaces" was practised as a single-admin, single-`devuser` box (`mesh-identityGap.md` §2). The shape of the answer is to **adopt Agent of Empires (AoE) as the interaction plane** and treat it as a generic subdomain behind an anti-corruption layer: AoE owns the session lifecycle, the terminal/diff/status view, and the per-session git worktree; agentbox binds a `did:nostr`, a session URN, a beads epic, and a scoped memory namespace at every session boundary. The aggregate root is `ManagedSession`; the sprint wires mechanisms that already exist, it does not invent them.

**If you remember only one thing:** a `ManagedSession` is an AoE session that has been given a sovereign identity at its boundary. AoE is an adopted generic subdomain — we conform to its REST API as a published language and never patch its `src/` (`mesh-aoeCompat.md` §8); the identity, URN, ledger, and namespace binding is the anti-corruption layer we own. No session exists without a `did:nostr`; no durable identifier is minted outside `management-api/lib/uris.js`; and the NIP-98 proxy is the sole ingress to the AoE daemon on `:9095`.

For the deep version, keep reading.

---

## Domain Purpose

The truth this domain owns is the current, identity-bound state of every interactive agent session agentbox runs: which harness is running, under which sovereign identity, against which worktree, with what work recorded, and in what run-state. "Session" means an AoE-managed unit created through `aoe add` / `POST /api/sessions`, backed by a tmux session namespaced `aoe_<title>_<id8>` (`mesh-aoeCompat.md` §Seam 2, `src/tmux/mod.rs:188`, `src/tmux/session.rs:316`) or an ACP structured view, that agentbox has stamped with a `did:nostr`, a session URN, a beads epic, and a project-scoped memory namespace.

Three things make this a domain rather than a launcher script. First, identity: a session is not a tmux window number — it is a sovereign principal with a persisted BIP-340 keypair derived per profile (`agent-identity.js:107-160`) and a content-addressed URN minted through `uris.js` (`uris.js:154`). Second, evidence: a session's work is not inferred from pane text — it is recorded as a beads epic whose child units are claimed and closed across the session lifecycle (`adapters/beads/local-sqlite.js:78-235`), and its lifecycle transitions are appended to the hash-chained events log (`adapters/events/local-jsonl.js:4-142`). Third, boundary: a session is driven by exactly one injection path and reached through exactly one authenticated ingress, so voice, nostr, and dashboard control converge on a single accountable seam rather than racing raw `tmux send-keys`.

Nothing in this domain owns the AoE session manager's internals, the LLM behind a harness, the semantic voice-intent plane, or the sovereign HTTP surfaces of the management API. It owns the binding, not the parts it binds.

---

## Bounded Context Definition

**Boundary**: The interactive session surface — AoE-managed sessions plus the identity, ledger, namespace, and injection bindings agentbox stamps on them. Everything runs inside the container.

**Owns** (IN):

- The `ManagedSession` aggregate — an AoE session that has been given a sovereign identity, worktree binding, and work ledger.
- `SessionIdentity` — the value object binding a `did:nostr`, a session URN, and an isolation profile to one session.
- `WorktreeBinding` — the value object binding a session to its AoE-managed git worktree and branch.
- The `LedgerEpic` reference — the beads epic that is a session's single work record, and the child-unit lifecycle mapped onto session turns.
- The `InjectionPath` — the single authenticated seam through which text enters a session (`POST /api/sessions/{id}/send`).
- The session lifecycle events (`SessionCreated`, `SessionClaimed`, `TurnCompleted`, `SessionClosed`) and their alignment to the bead lifecycle, the kind-30840 digest, and the events adapter.
- The `Profile`/`Seat` isolation contract — `HOME` + `CLAUDE_CONFIG_DIR` both pointed at `$WORKSPACE/profiles/<name>` for a redirected harness (I05).
- The `SessionSeed` — the declarative session list in `[interaction_plane].session_seeds` that replaces the tmux-autostart harness windows.

**Does not own** (OUT):

- The AoE session manager, its tmux/ACP rendering, its per-session worktree/sandbox mechanics, its dashboard, or its plugin runtime. AoE is an **adopted generic subdomain** (ADR-042); its REST/WS API is an Open Host Service whose published language we conform to. Its `src/` is never patched (I08).
- Nostr cryptography, signing, relay transport, pod-mailbox durability, and the kind-30840 session digest. DDD-003 and `services/nostr-pod-bridge` own these; this domain hands over unsigned payloads and consumes the digest as a lifecycle sink.
- The RuVector store. Memory is consumed as the DDD-016 port under a project-scoped namespace; this domain never issues raw SQL and opens no store.
- The management-API sovereign surfaces (`/lo` viewer, setup dashboard, `/v1/voice-intent`, payments, llm-marketplace, pods, pod-git, uri-resolver, kg-elevation, `/v1/system`). AoE is a **consumer** of these, not a replacement (`mesh-apiTelemetry.md` §AoE-replaceability).
- The headless consultant MCP tier, the `[model_routing]` projection, and the AQE fleet routing. These are not sessions and never become sessions (I04, ADR-041 untouched).
- The semantic voice-intent plane (`/v1/voice-intent`, kind-31402 ActionRequests, `agent_action` beams). Orthogonal; a different abstraction entirely (`mesh-voiceTab0.md` §B).
- VisionClaw-owned surfaces (voice console `:8444`/`:8443`, `visionclaw-server:4000`, the Unmute STT/TTS stack). Out of context by construction (I10).

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Session** (`ManagedSession`) | The aggregate root: an AoE-managed interactive agent session that agentbox has bound to a sovereign identity. Created via `aoe add` / `POST /api/sessions` (`src/server/mod.rs:1655-1847`), keyed by an opaque AoE session id, and stamped with a `SessionIdentity`, a `WorktreeBinding`, and a `LedgerEpic`. Replaces the tmux "harness window" as the unit of interactive work. |
| **Harness** | The concrete agent CLI a session runs — the coding tool, not the window. Native AoE harnesses (`claude`, `codex`, `gemini`) resolve through the ACP registry (`src/acp/agent_registry.rs`); redirected harnesses (OpenRouter, ZAI = the `claude` binary with `ANTHROPIC_BASE_URL` redirect) and non-native harnesses (codewhale, nanocoder) resolve via `custom_agents` / `agent_command_override` / `env_allowlist` (`mesh-aoeCompat.md` §Seam 3). One session, one harness. |
| **Profile** / **Seat** | The isolation unit a redirected harness runs under: a directory `$WORKSPACE/profiles/<name>` with `HOME` **and** `CLAUDE_CONFIG_DIR` both pointed at it, so a routed Claude binary reads that seat's runtime-written `settings.local.json` (its own `ANTHROPIC_BASE_URL`/token) and never the global `/home/devuser/.claude` direct-Anthropic key (`config/tmux-autostart.sh:170-174`, I05). A profile also selects the session's `did:nostr` via `AGENTBOX_PROFILE`. |
| **SessionIdentity** | The value object binding one session to a sovereign principal: `{ did:nostr:<hex>, sessionUrn, profile }`. The `did:nostr` is derived by `agent-identity.loadOrMint()` from the session's `AGENTBOX_PROFILE` (`agent-identity.js:107-160`); the URN is the `session-<sha256-12>` minted below. No session exists without one (I01). |
| **WorkLedger** / **Bead** / **Epic** | The beads work record. A session's `LedgerEpic` is a `urn:agentbox:bead:<scope>:<sha256-12>` epic (`createEpic`, `local-sqlite.js:78-92`); a **Bead** is any work unit (epic or child) in the SQLite ledger; a session **turn** maps to `createChild`/`claim`, session close to `close`. The beads ledger is a session's single durable work record (I07). Requires `adapters.beads = "local-sqlite"` (rebuild-class flip from the running `"off"`, `agentbox.toml:12`). |
| **InjectionPath** | The single authenticated seam through which text enters a session: `POST /api/sessions/{id}/send` on the AoE API (`api.md:113-158`, `src/server/mod.rs:1693`). It types the message literally + Enter, honours a per-agent paste-burst delay, and serialises concurrent POSTs to the same session so voice and nostr cannot interleave keystrokes. All session writes go through it (I06); raw `tmux send-keys` into an AoE pane bypasses AoE's accounting and is prohibited. |
| **StructuredView** | AoE's ACP rendering of a session — the default for `claude`/`codex`/`gemini`. Has **no tmux pane**, so `POST /send` returns `400 acp_mode_unsupported` (`api.md:136`, `docs/structured-view.md:3-5`). A voice-driven session (the tab-0 coordinator) therefore cannot use the structured view for the send-keys model (ADR-044). |
| **TerminalView** | AoE's raw-PTY rendering of a session, backed by an ordinary tmux pane, where `POST /send` and `GET /output` work. The tab-0 coordinator session runs in terminal view because the voice injection path needs a pane (ADR-044); adopting AoE's ACP prompt channel for voice is roadmap, not sprint. |
| **SessionSeed** | A declarative session definition in `[interaction_plane].session_seeds` — harness, profile, worktree branch, view — that AoE materialises at boot. The set of seeds replaces the harness windows the old `tmux-autostart.sh` created imperatively (D3, ADR-042). Seeding is idempotent on the seed key. |
| **AoE daemon** | The supervised `aoe serve --auth none --behind-proxy --host 127.0.0.1 --port 9095` program (D3). Port 9095 because 8080 is code-server and 7777 is the nostr relay (both live, `mesh-webSurfaces.md`). Reachable only through the NIP-98 proxy (I03). |
| **NIP-98 proxy** | The reverse proxy that verifies a NIP-98 (kind-27235) header, populates the caller's pubkey, and forwards to the loopback AoE daemon with `X-Forwarded-For` — reusing `middleware/auth.js` verification (`auth.js:36-64`). It is the sole ingress to `:9095` (I03); `--behind-proxy --auth none` on loopback trusts only what the proxy forwards. |
| **owner_did** | The container operator's public federation identity `did:nostr:<AGENTBOX_PUBKEY>`. Distinct from a session's `did:nostr`, which is a per-session principal derived from that session's profile keyfile. |

---

## Aggregates

### ManagedSession (Root)

The `ManagedSession` is the consistency boundary and the primary aggregate of this domain. It is agentbox's identity-bound projection of one AoE session. AoE owns the session's raw lifecycle and rendering; the `ManagedSession` owns the bindings that make it sovereign and accountable.

**Identity**: `urn:agentbox:activity:<scope>:session-<sha256-12>` — minted through `management-api/lib/uris.js` `mint()` against the `activity` kind (`uris.js:97,154`; `activity` is owner-scoped and content-addressed). `<scope>` is the session's own 64-character BIP-340 x-only pubkey (the session `did:nostr`, not the operator `owner_did`); the `session-<sha256-12>` local segment is content-addressed over the session-create inputs (harness, profile, worktree, start timestamp). The URN is minted by the **session-create shim** (a thin hook that calls the management API when AoE creates a session) and stamped on the session record; ad-hoc URN construction stays prohibited (I02, ADR-013). Reusing the `activity` kind rather than minting a new URN kind follows the Code-as-Harness precedent (DDD-005).

**Composition** — one root, two value objects, one reference:

| Member | Kind | Notes |
|---|---|---|
| `SessionIdentity` | Value object | `{ did:nostr, sessionUrn, profile }` — the sovereign binding (below). Immutable for the session's life. |
| `WorktreeBinding` | Value object | `{ branch, worktreePath, sandbox }` — the AoE-managed worktree (below). |
| `LedgerEpic` | Reference | `urn:agentbox:bead:<scope>:<sha256-12>` — the beads epic that is this session's work record. |

**Fields**:

| Field | Type | Notes |
|---|---|---|
| `aoeSessionId` | `string` | AoE's opaque session id — the routing key for `/api/sessions/{id}/*`. AoE keys everything by this, never by "window 0" (`mesh-voiceTab0.md` §gap 1). |
| `urn` | `urn:agentbox:activity:…` | Full canonical identity, minted via `uris.js`. |
| `identity` | `SessionIdentity` | The `did:nostr` + URN + profile binding (I01). |
| `worktree` | `WorktreeBinding` | The AoE-managed worktree + branch. |
| `ledgerEpicUrn` | `urn:agentbox:bead:…` | The session's `LedgerEpic` (I07). |
| `harness` | `string` | The agent CLI (`claude` \| `codex` \| `gemini` \| `openrouter` \| `zai` \| `codewhale` \| `nanocoder`). |
| `view` | `'terminal' \| 'structured'` | Terminal view for voice-driven / send-keys sessions; structured (ACP) otherwise (ADR-044). |
| `seat` | `string \| null` | Profile/seat directory for a redirected harness; `null` for native OAuth harnesses on the global config. |
| `state` | `SessionState` | The AoE run-state FSM (below), read from `GET /api/sessions?state=live` rather than inferred from pane text. |
| `seedKey` | `string \| null` | The `SessionSeed` that materialised this session, or `null` for an ad-hoc / operator-created session. |
| `createdAt` | ISO-8601 | Timestamp of the session-create shim call. |

**Lifecycle states**:

```
Seeded → Created → Claimed → Working ⇄ Waiting/Idle → Closed
                      ↑           │
                      └──(turn)───┘
                                  │
                              Error → Closed

Seeded   : a SessionSeed exists in [interaction_plane].session_seeds, not yet materialised
Created  : AoE created the session; the shim minted the URN + did:nostr, opened the LedgerEpic (createEpic)
Claimed  : a driver (operator, voice, nostr) took the session; first bead child claimed
Working  : a turn is in flight (AoE state Running); a bead child is open
Waiting  : awaiting input (AoE state Waiting); voice/nostr may inject via the InjectionPath
Idle     : no active turn (AoE state Idle)
Error    : AoE state Error; the session is surfaced but not driven
Closed   : session ended; LedgerEpic closed, kind-30840 digest emitted, SessionClosed appended to the events chain
```

The AoE status FSM (`Running`/`Waiting`/`Idle`/`Error`, `GET /api/sessions`, `api.md:23-63`) is authoritative for run-state — it supersedes the old inference from pane text and the tab0-bridge `turn-sink` hook's status role (ADR-044; the hook is retained for transcript, not status). Session creation is idempotent on the `SessionSeed` key: re-materialising a seed after a restart returns the same `ManagedSession` and does not create a duplicate epic (I07).

**Invariants**:

- **I01**: No `ManagedSession` exists without a `SessionIdentity` carrying a real `did:nostr`. The session-create shim derives it from `AGENTBOX_PROFILE` via `agent-identity.loadOrMint()` (`agent-identity.js:107-160`) before the session is exposed; a session that cannot obtain a `did:nostr` is not created. `did:nostr:local` fail-open is a keygen fallback for the identity primitive, never a substitute for the binding.
- **I02**: Every durable identifier on a `ManagedSession` — the session URN, the `LedgerEpic` bead URN, the memory namespace, an optional mandate — is minted through `management-api/lib/uris.js` (`uris.js:154`). Ad-hoc template-literal / `format!()` URNs are prohibited (ADR-013).
- **I07**: A session's `LedgerEpic` is its single durable work record. Session create opens exactly one epic (`createEpic`); turns map to `createChild`/`claim`; close maps to `close`. No parallel work record (a bespoke JSON file, a pane scrape) is authoritative.

---

### SessionIdentity (value object)

`SessionIdentity` is the sovereign binding of one session: the object that makes an AoE session a principal. It is immutable for the session's life and is minted by the session-create shim.

**Shape**: `{ did:nostr:<hex>, sessionUrn: urn:agentbox:activity:…, profile: <slug> }`.

- **`did:nostr`** — derived by `agent-identity.loadOrMint()` from `AGENTBOX_PROFILE=<session-slug>`, which resolves a persisted BIP-340 privkey keyfile 0600 at `/var/lib/agentbox/identities/agent-did-<profile>.key` (`agent-identity.js:107-145`) or mints and persists one on first use. Distinct profile ⇒ distinct persisted `did:nostr`. The mechanism already exists; the sprint sets a distinct `AGENTBOX_PROFILE` per session so each gets its own principal instead of the whole box collapsing to one `default` did (`mesh-identityGap.md` §4).
- **`sessionUrn`** — the `ManagedSession` URN (above), scoped to this session's own pubkey.
- **`profile`** — the isolation seat slug; the same slug that names the keyfile and, for redirected harnesses, the `$WORKSPACE/profiles/<slug>` directory.

**Invariants**:

- **I05**: Profile isolation is `HOME` **and** `CLAUDE_CONFIG_DIR` both pointed at `$WORKSPACE/profiles/<name>` for a redirected Claude harness (`config/tmux-autostart.sh:170-174`). AoE reproduces this via the session's `env_allowlist` / profile env — if it does not, a routed harness leaks onto the global direct-Anthropic key and mis-bills. `settings.local.json` carries the live key at runtime and is never baked into the image.
- **I04**: A `SessionIdentity` is only ever attached to an interactive session. The headless consultant MCP tier, the `[model_routing]` projection, and the AQE fleet are not sessions and are never given a `SessionIdentity` — they remain the cost-effective non-session path (dual-path, PRD-013 N06 preserved; ADR-041 untouched).

---

### WorktreeBinding (value object)

`WorktreeBinding` binds one session to its isolated git working tree. AoE creates and owns the worktree and the optional sandbox natively (`mesh-aoeCompat.md` §capability "Per-session git worktree + sandbox"); the binding records which one belongs to which session.

**Shape**: `{ branch: <ref>, worktreePath: AbsPath, sandbox: bool }`.

AoE's per-session worktree supersedes the hand-rolled `harness/<name>` worktree block and the `harness-merge` helper of the old layout (`config/tmux-autostart.sh:400-427,436-463`). The `harness-merge` semantics — a coordinator-gated `git merge --no-ff` from a harness branch — are reworked to target AoE worktree branches; harnesses still never self-merge (the DDD-010 I03/I04 discipline carries forward, §Migration).

**Invariant**:

- **I08**: The worktree and sandbox mechanics belong to AoE, the adopted generic subdomain. This domain reads the binding through the AoE API and never patches AoE's `src/` to change worktree behaviour — the fork stays a clean mirror (`mesh-aoeCompat.md` §8, zero carried patches). Any worktree policy agentbox needs rides configuration (`config.toml`, profiles, seeds), never a source patch.

---

### LedgerEpic (reference) and the turn lifecycle

The `LedgerEpic` is not an aggregate this domain stores; it is a reference into the beads adapter (ADR-005 slot), which owns bead persistence and URN minting. A session's epic and its child units are the session's work record.

**Identity**: `urn:agentbox:bead:<scope>:<sha256-12>` — minted by the adapter via `uris.mint({ kind: 'bead', pubkey, payload })` (`local-sqlite.js:85`), content-addressed with a nonce so same-title beads in one millisecond do not collide.

**Lifecycle mapping**:

| Session transition | Beads call |
|---|---|
| `SessionCreated` | `createEpic({ title, actor: <session-did> })` → the `LedgerEpic` |
| `SessionClaimed` / turn start | `createChild(...)` then `claim(...)` |
| `TurnCompleted` | child unit resolved / next child readied (`getReady`) |
| `SessionClosed` | `close(...)` on the epic |

**Invariant**: reinforces I07 — the epic is authoritative. Enabling this requires flipping `adapters.beads` from the running `"off"` (`agentbox.toml:12`) to `"local-sqlite"` and mounting a `routes/beads.js` HTTP surface (ADR-043); the adapter itself is complete (`local-sqlite.js:78-235`) and only gated off.

---

## SessionState projection

`SessionState` is the run-state a `ManagedSession` reports, read from AoE rather than inferred. It is a thin projection of AoE's own FSM onto the domain vocabulary.

| AoE state (`GET /api/sessions`) | Domain meaning | Driver behaviour |
|---|---|---|
| `Running` | A turn is in flight (`Working`) | InjectionPath serialises; wait |
| `Waiting` | Awaiting input | InjectionPath may inject |
| `Idle` | No active turn | InjectionPath may inject |
| `Error` | Session errored | Surface, do not drive |

Reading state from the API (`api.md:23-63`) removes the pane-text inference the tab0-bridge did today and retires the `turn-sink` hook's status role (`mesh-voiceTab0.md` §A, ADR-044). The transcript sink is retained; it is simply no longer load-bearing for status.

---

## Domain Events

| Event | Trigger | Key payload | Alignment |
|---|---|---|---|
| `SessionCreated` | AoE creates a session; the shim mints the URN + `did:nostr` and opens the `LedgerEpic` | `session_urn`, `did`, `harness`, `profile`, `worktree_branch`, `epic_urn` | beads `createEpic`; appended to the hash-chained events log (`local-jsonl.js:4-142`) |
| `SessionClaimed` | A driver (operator / voice / nostr) takes the session; first child claimed | `session_urn`, `driver`, `child_urn` | beads `createChild`/`claim` |
| `TurnCompleted` | A turn finishes (AoE state leaves `Running`) | `session_urn`, `child_urn`, `state` | beads child resolved; transcript sink (`/hook/turn`) retained, non-load-bearing for status |
| `SessionClosed` | Session ends | `session_urn`, `epic_urn`, `summary_ref` | beads `close`; **kind-30840** session digest emitted via `services/nostr-pod-bridge` (`nostr-session-summary.py`, DDD-003); `SessionClosed` appended to the events chain (`/v1/system/audit-chain`) |

All four events are emitted through the ADR-005 observability middleware as plain domain projections in JSON, then privacy-filtered (ADR-008) and JSON-LD-encoded opt-in (ADR-012) in the standard three-layer order. The alignment is deliberate: the bead lifecycle is the *durable work* record, the kind-30840 digest is the *federated summary* to the operator's mobile client (a sibling of the kind-30841 project digest, DDD-015), and the events chain is the *tamper-evident audit* record — three sinks, one lifecycle, no new substrate.

---

## Context Map

The Interaction Plane sits at the seam between agentbox's sovereign fabric and an adopted upstream product. The relationships, in strategic-DDD terms:

| Neighbour context | Pattern | Relationship |
|---|---|---|
| **Agent of Empires** (upstream `agentbox-of-empires`, pinned flake input) | **Adopted generic subdomain** behind an **Anti-Corruption Layer**; AoE REST/WS is an **Open Host Service** we are **Conformist** to | AoE owns session lifecycle, view, worktree, dashboard, plugin runtime. We conform to its published `/api/*` language (`src/server/mod.rs:1655-1847`) and never patch its `src/` (I08). The ACL is the NIP-98 proxy + the session-create shim (below). Pinned to `d615b8c8` / v1.13.2; clean mirror, zero carried patches (`mesh-aoeCompat.md` §8). |
| **Multi-Harness Coordination** ([DDD-010](./DDD-010-multi-harness-coordination-domain.md)) | **Partially superseded** | DDD-010's `WorktreeCoordinator` and `HarnessProfile` aggregates and its tab-numbered MAD model are superseded by `ManagedSession` + AoE's native worktree (see §Migration). Its *invariants* on worktree isolation and no-self-merge (I02–I04) survive as domain rules here; its `SessionPersistence` aggregate (tmux-resurrect) is retired in favour of AoE session state. |
| **Sovereign Messaging** ([DDD-003](./DDD-003-sovereign-messaging-domain.md)) | **Customer–Supplier** (we are the customer) | Supplies the `did:nostr` crypto, the pod mailbox, the relay, and the kind-30840 digest path. We hand over an unsigned digest payload at `SessionClosed`; the nsec never enters this domain. |
| **Memory Learning** ([DDD-016](./DDD-016-memory-learning-domain.md)) | **Customer–Supplier** (we are the customer) | Supplies the RuVector memory port. We scope each session into a namespace `user:<pubkey>:proj:<repo-slug>:<ns>` (extending the per-user `_effectiveNamespace`, `routes/memory.js:57-73` with a project axis) so sessions cannot read each other's memory. Requires `[memory].admin_access_mode = "scoped"` (rebuild-class flip from the running `"permissive"`, `agentbox.toml:316`, I09). |
| **Code-as-Harness / Code execution** ([DDD-005](./DDD-005-code-execution-domain.md)) | **Partnership** (shared URN grammar) | Precedent for reusing an existing URN kind (`activity`) for a new capability rather than expanding the eighteen-kind grammar. Session URNs and code-harness URNs share one scope and one minter (`uris.js`). |
| **Sovereign HTTP surfaces** (management-API: `/lo`, setup, `/v1/voice-intent`, payments, marketplace, pods, KG, `/v1/system`) | **Conformist consumer** (AoE consumes them) | Stay in the management API unchanged. AoE's dashboard is a *consumer* — it may render `/v1/system`, `/v1/agent-events/stream`, `/v1/projects`, and scrape `:9091/metrics` — not a replacement (`mesh-apiTelemetry.md`, `mesh-webSurfaces.md`). Absorbing sovereign panels into AoE as plugins is roadmap (D7). |
| **Voice semantic plane** (`/v1/voice-intent`, kind-31402, `agent_action` beams) | **Separate Ways** | Orthogonal. The live conversational voice loop repoints to the InjectionPath (ADR-044); the *semantic* voice-intent seam targets the KG/VisionClaw substrate and is untouched (`mesh-voiceTab0.md` §B). |
| **VisionClaw** (host project; voice console `:8444`/`:8443`, `visionclaw-server:4000`, Unmute stack) | **Out of context** | Referenced by role, never bound. Its surfaces are excluded from this domain by construction (I10). |

**The Anti-Corruption Layer** is the whole point of the domain and has two organs:

1. **The NIP-98 proxy** (identity ingress). AoE speaks only `token`/`passphrase`/`none`/`read-only`/`cityhall` auth (`src/cli/serve.rs:18-33`) — no `did`, no pubkey, no URN (`mesh-identityGap.md` §3). We run `aoe serve --auth none --behind-proxy --host 127.0.0.1 --port 9095` and front it with a proxy that verifies a NIP-98 (kind-27235) header, populates the caller pubkey, and forwards with `X-Forwarded-For`, reusing `middleware/auth.js` verification (`auth.js:36-64`; `--behind-proxy` trusts forwarded headers, `serve.rs:250-256`, `auth.rs:36`). Native NIP-98 inside AoE `auth.rs` was considered and **rejected** as fork-invasive (the `TokenSource` enum at `auth.rs:465` is noted as the hook point if ever revisited, ADR-042).
2. **The session-create shim** (identity binding). A thin hook on AoE's session lifecycle that calls the management API to derive the `did:nostr`, mint the session URN, open the `LedgerEpic`, and scope the memory namespace — translating AoE's identity-free session into a sovereign `ManagedSession`. AoE stays generic; agentbox owns the translation.

---

## Ports (consumed)

| Port | Direction | Counterpart | Contract |
|---|---|---|---|
| **AoeSessionPort** | Outbound + inbound | AoE daemon `:9095` via the NIP-98 proxy | Create (`POST /api/sessions`), inject (`POST /api/sessions/{id}/send`), read output (`GET /api/sessions/{id}/output`), list + status (`GET /api/sessions?state=live`), start/stop. The Open Host Service we conform to (`api.md`, `src/server/mod.rs:1655-1847`). |
| **IdentityPort** | Outbound | `management-api/lib/agent-identity.js` | `loadOrMint({ profile })` → persisted BIP-340 `did:nostr` (`agent-identity.js:107-160`). Distinct profile ⇒ distinct did (I01, I05). |
| **UriMintPort** | Outbound | `management-api/lib/uris.js` | `mint({ kind, pubkey, payload })` for the session `activity` URN and every other durable id (I02). |
| **BeadsPort** | Outbound | ADR-005 beads slot (`adapters/beads/local-sqlite.js`) via `routes/beads.js` | `createEpic`/`createChild`/`claim`/`close`/`getReady`/`show` mapped onto the session lifecycle (I07). Requires `adapters.beads="local-sqlite"` (I09). |
| **MemoryNamespacePort** | Outbound | DDD-016 memory port (`routes/memory.js`) | Scope a session to `user:<pubkey>:proj:<repo-slug>:<ns>` (extends `_effectiveNamespace`, `memory.js:57-73`). Requires `admin_access_mode="scoped"` (I09). |
| **EventsPort** | Outbound (publish) | ADR-005 events slot (`adapters/events/local-jsonl.js`) | Appends the four lifecycle events to the hash-chained log; verified at `/v1/system/audit-chain`. |
| **DigestPort** | Outbound (gated, fail-open) | DDD-003 / `services/nostr-pod-bridge` | Hands an unsigned kind-30840 session digest at `SessionClosed`; the bridge signs, dual-writes the pod inbox, and relays. The nsec never enters this domain. |
| **MandatePort** (optional) | Outbound | `management-api/lib/mandate.js` via `/v1/mandate` | Optionally mint a per-session WAC mandate binding the session did to its worktree/pod container (`createMandate`, `mandate.js:99-127`); revocable via kind-30078. Library complete, currently unwired (ADR-043). |
| **AuthorityConsumerPort** (optional) | Inbound | `management-api/lib/authority.js` | A local `awaitDecision` consumer (embedded relay or dashboard approval prompt) so zero-tolerance actions can be *released* rather than universally DENIED for want of a decision consumer (`authority.js:217-224`, ADR-043). |
| **ProxyIngressPort** | Inbound | NIP-98 proxy → `:9095` | The sole authenticated ingress; verifies kind-27235, forwards with `X-Forwarded-For` (I03). |

---

## Domain Rules (cross-aggregate)

- **R01**: AoE is adopted, not forked. All integration — supervisor block, proxy, config seeds, profiles, plugins — lives in the agentbox repo; the fork stays a clean mirror pinned to a commit/tag. Any `src/` patch is prohibited (I08, ADR-042).
- **R02**: Identity binds at the session boundary. Every `ManagedSession` gets a `did:nostr`, a session URN, a `LedgerEpic`, and a scoped memory namespace at create time, or it is not a `ManagedSession` (I01, I02, I07).
- **R03**: One ingress, one injection path. The NIP-98 proxy is the only way to reach the AoE daemon (I03); `POST /api/sessions/{id}/send` is the only way text enters a session (I06). Raw `tmux send-keys` into an AoE pane is prohibited.
- **R04**: Every durable identifier is minted through `uris.js` (I02, ADR-013). No ad-hoc URN anywhere in this domain.
- **R05**: Sessions are interactive only. Consultants, model routing, and the AQE fleet are never sessions (I04); the semantic voice-intent plane and VisionClaw surfaces are out of context (I10).
- **R06**: Rebuild-class gates flip only in the flake/manifest pass. `adapters.beads` and `[memory].admin_access_mode` are baked at nix build; flipping them needs `nix build` + container recreate, so they land in the sprint's Dockerfile/flake pass, never a live toggle (I09, `mesh-identityGap.md` §5).

---

## Invariants (consolidated)

| ID | Statement |
|---|---|
| **I01** | No `ManagedSession` exists without a `SessionIdentity` carrying a real `did:nostr`, derived per-profile via `agent-identity.loadOrMint()` before the session is exposed. |
| **I02** | Every durable identifier — session URN, bead URN, memory namespace, mandate — is minted through `management-api/lib/uris.js`. Ad-hoc URN construction is prohibited (ADR-013). |
| **I03** | The NIP-98 proxy is the sole ingress to the AoE daemon on `:9095`. `aoe serve` binds loopback with `--behind-proxy --auth none`; nothing else may reach the port, or auth is bypassable by any container-local process. |
| **I04** | Consultants (the five MCP servers), the `[model_routing]` projection, and the AQE fleet are never sessions and never receive a `SessionIdentity`. The dual-path (session vs headless MCP) is preserved (PRD-013 N06). |
| **I05** | Profile isolation is `HOME` **and** `CLAUDE_CONFIG_DIR` both pointed at `$WORKSPACE/profiles/<name>` for a redirected harness; AoE reproduces it via the session's `env_allowlist`/profile env, or a routed harness leaks the global direct-Anthropic key. |
| **I06** | Voice, nostr, and dashboard writes enter a session only through the InjectionPath (`POST /api/sessions/{id}/send`). Raw `tmux send-keys` into an AoE pane bypasses AoE accounting and serialisation and is prohibited. |
| **I07** | The beads `LedgerEpic` is a session's single durable work record: one epic per session, children per turn, closed at session end. No parallel record is authoritative. |
| **I08** | AoE's `src/` is never patched. The fork is a clean mirror; all integration is overlay-only (flake input, supervisor, proxy, config, plugins) in the agentbox repo. |
| **I09** | Rebuild-class gates (`adapters.beads = "local-sqlite"`, `[memory].admin_access_mode = "scoped"`) flip only via an image rebuild, never a live runtime toggle. |
| **I10** | VisionClaw surfaces (voice console `:8444`/`:8443`, `visionclaw-server:4000`, the Unmute stack) and the semantic voice-intent plane are out of this bounded context; they are referenced by role, never bound as sessions. |

---

## Migration and Coexistence

**Supersession of the MAD tmux layout (ADR-025 / PRD-013)**: the fifteen-window `agentbox` tmux session built imperatively by `config/tmux-autostart.sh` is superseded in place — a one-shot, git-tracked upgrade with no parallel switchover (D1). Harness windows 8–14 (OpenRouter, ZAI, Antigravity, DeepSeek, Perplexity, Ollama, Codex) become AoE-managed `ManagedSession`s materialised from `SessionSeed`s; windows 4 (Logs) and 7 (Git) are absorbed by the AoE dashboard/diff view; windows 5 (System) and 6 (VNC) remain plain tmux; the operator-mutated 0–3 region is formalised into named AoE sessions, with the tab-0 coordinator staying special (terminal view for voice, ADR-044). The live layout has already diverged from the committed script (`mesh-tmuxHarness.md` §1) — the rewrite reconciles the *running* layout, not the script. Perplexity (window 12) is retired as a session; research stays on `mcp__perplexity` + `consultant-perplexity` + skills (it was never a coding agent, no worktree).

**Which of DDD-010 survives**: DDD-010's *isolation invariants* carry forward, re-homed here — profile isolation (its I01/I06 → our I05), worktree-per-editing-harness (its I02 → AoE's native worktree + our `WorktreeBinding`), and no-self-merge / coordinator-gated merge (its I03/I04 → the reworked `harness-merge` against AoE branches). What is **superseded**: DDD-010's `HarnessProfile` aggregate (tab-numbered, `profile-<tab>` URN) is replaced by `ManagedSession` + `SessionIdentity` (profile-slug-keyed, `session-<sha256-12>` URN); its `WorktreeCoordinator` aggregate is replaced by AoE's native per-session worktree owned across the ACL (I08); its `SessionPersistence` aggregate (tmux-resurrect / continuum) is retired in favour of AoE session state read from the API. The two-path Access model (Direct Access vs Consultant MCP) survives verbatim as I04's dual-path.

**Agent coverage** (tabs → sessions, D6): native AoE harnesses cover `claude`/`codex`/`gemini`; OpenRouter and ZAI are the `claude` binary redirected via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` and need a per-AgentSpec `env_allowlist` entry (or an `agent_command_override` wrapper) because `ANTHROPIC_BASE_URL` is **not** in AoE's default env-forward set — miss it and the harness silently mis-bills to direct Anthropic (the sprint's top risk, `mesh-aoeCompat.md` §risks). Codewhale (DeepSeek) and nanocoder (Ollama) enter as `custom_agents` (terminal view) with borrowed `agent_detect_as` status heuristics. The Antigravity model discrepancy (tab `gemini-2.5-flash` vs consultant `gemini-3.5-flash`, `mesh-tmuxHarness.md` §3) is aligned as part of the pass.

**Voice coexistence** (ADR-044): `sendToTab0()` repoints from `tmux send-keys -t agentbox:0` (`server.mjs:92-99`, TAB0 hardcoded `server.mjs:33-34`) to `POST /api/sessions/{TAB0_ID}/send`, gaining paste-burst delay and per-session serialisation; the session id is resolved at bridge start via `GET /api/sessions` and pinned in config, with a fail-open fallback to raw send-keys if AoE is down. The Unmute↔bridge `/v1/chat/completions` contract, the `/v1/voice-intent` semantic seam, the NIP-59 mirror, and the kind-30840/30841 digests are untouched.

**Phased posture**: the plane is manifest-gated through `[interaction_plane]` in `agentbox.toml` (`enabled`, `port`, `dashboard`, `session_seeds`, `proxy_auth`); the daemon + config apply-class is `boot`, the binary is `rebuild` (ADR-039 honesty). The beads and memory-scope gates are rebuild-class (I09); an operator can stand up sessions and the proxy without flipping them, then land the identity payload in the flake/manifest pass.

---

## Open Questions

1. **ACP prompt channel for voice**: the tab-0 coordinator runs in terminal view because AoE's structured (ACP) view has no pane and `POST /send` returns `400 acp_mode_unsupported` (`api.md:136`). Teaching the voice path AoE's ACP prompt channel — so the coordinator can run in the richer structured view — is explicitly roadmap, not sprint (ADR-044). Whether the roadmap channel should be a first-class `InjectionPath` variant or a separate seam is deferred.

2. **Sovereign-panel absorption into the AoE dashboard**: surfacing the management-API sovereign panels (`/lo` viewer, `/v1/system`, memory, pods) *inside* the AoE dashboard via the `aoe-plugin-api` (`API_VERSION = 10`, `RuntimeSpec` JSON-RPC workers, dockable pane slots) is a substantial follow-up (D7), together with an event-mirror plugin worker streaming AoE's operational SQLite event log into RuVector/the events chain so the sovereign audit record stays complete. The plugin runtime is beta; whether the panels ship as AoE plugins or stay as separate origins the operator navigates to is deferred to a follow-up sprint.

3. **Per-session mandate scope** — **RESOLVED (operator decision 2026-08-04, ADR-043 D4.5): lazy.** Mandates mint on a session's first pod write (mint-if-absent in the shim); session seeds carry `eager_mandate = true` for known pod-writers; worktree-only sessions never mint one.

4. **Authority decision consumer** — **RESOLVED (operator decision 2026-08-04, ADR-043 D4.7): both, layered.** The embedded relay is the canonical consumer (`awaitDecision` subscribes for signed kind-31403 answers to the gate's 31402; mobile approval via the existing allowlisted Amethyst/Amber key); a pending-approvals dashboard surface is a signing front-end that publishes a 31403 via the operator delegation key. Unsigned HTTP approval is prohibited.

5. **Multi-human tenancy**: this domain assumes a single operator running multiple sessions, each a distinct per-session `did:nostr`. Hosting more than one *human* on the AoE dashboard would require enabling `[sovereign_mesh.multi_user]` (currently `false`, `agentbox.toml:185`) and the PUAF; the per-session did model already covers single-operator multi-session, so multi-human is reserved and out of scope here.

---

## References

| Reference | Notes |
|---|---|
| PRD-021 | Product requirements for the interaction-surface consolidation sprint — the work streams, NFRs, and success criteria this domain realises. |
| ADR-042 | Adopt Agent of Empires as the interaction plane, overlay-only; supersedes ADR-025. Records the rejected native-NIP-98-in-AoE alternative. |
| ADR-043 | Session-identity binding — the sovereign payload (did per session, session URN, beads ledger, scoped namespaces, mandates, NIP-98 proxy, authority consumer). |
| ADR-044 | Voice-plane repoint — `sendToTab0()` → AoE `/send`; terminal-view-for-voice decision; ACP channel deferred. |
| DDD-003 | Sovereign messaging — owns nostr crypto, pod mailbox, relay, and the kind-30840 digest path this domain hands payloads to. |
| DDD-005 | Code execution — the URN-reuse precedent (Code-as-Harness) followed by reusing the `activity` kind for session URNs. |
| DDD-010 | Multi-harness coordination — **partially superseded**: isolation invariants survive, the tmux-numbered aggregates do not (see §Migration). |
| DDD-016 | Memory learning — supplies the RuVector memory port this domain scopes per-project. |
| ADR-005 | Pluggable adapters + observability — supplies the beads and events slots and the dispatch middleware. |
| ADR-013 | Canonical URI grammar — all identities `urn:agentbox:<kind>:[<scope>:]<local>`, minted via `uris.js`. |
| ADR-017 / ADR-028 | Multi-tenant pods / per-user agent fabric — the identity fabric this domain draws session identities from. |
| ADR-025 / PRD-013 | The **superseded** MAD tmux multi-harness architecture. |
| ADR-039 | Apply-class honesty — the interaction-plane daemon (`boot`) vs binary (`rebuild`) catalogue entry. |
| ADR-041 | Model routing, one policy many projections — **untouched**; the routing/AQE plane is not a session (I04). |
