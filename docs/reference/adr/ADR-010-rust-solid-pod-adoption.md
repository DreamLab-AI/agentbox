# ADR-010: solid-pod-rs as first-class pod server

**Status:** Accepted
**Date:** 2026-04-24
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-005 (Pluggable adapter architecture), ADR-006 (Immutable runtime bootstrap), ADR-007 (Runtime contract and container hardening), ADR-009 (Embedded Nostr relay and pod-inbox bridge), PRD-001 (Capabilities and adapters), PRD-004 (External agent messaging)

## TL;DR for newcomers
*Skip if you already know why the DreamLab-AI sovereign data stack is shaped the way it is.*

[`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) is a first-party DreamLab-AI project — a Rust-native Solid Protocol 0.11 server with WAC, LDP containers, NIP-98 Schnorr auth, Solid Notifications, and atomic-rename filesystem storage. **It is the home of the JSS Rust crates** the team developed in earlier sprints: did:nostr resolution, NIP-98 Schnorr verification, signed outbound webhooks, rate-limit + quota operator surface, and JSS v0.4 wire compatibility were all absorbed under the `solid-pod-rs` name and ship today as Cargo features in `lib/solid-pod-rs.nix`. This ADR makes it the **first-class default** implementation for the agentbox `pods` adapter. Together with [`nostr-rs-relay`](ADR-009-embedded-nostr-relay.md) (external-agent messaging), the sovereign identity layer from [sovereign-bootstrap.py](../../../scripts/sovereign-bootstrap.py), and the [privacy-filter middleware](ADR-008-privacy-filter-routing.md), it forms the **sovereign data stack**: a coherent substrate for identity, messaging, durable storage, and PII governance that each agentbox container owns end-to-end. The 108-line Python stub previously shipped as `local-jss` was deleted on 2026-04-25; the schema enum no longer accepts that value.

**If you remember only one thing:** solid-pod-rs is the pod half of the sovereign data stack. It is part of agentbox, not an external integration.

For the deep version, keep reading.

## Context

### Current state

The `pods` adapter slot (ADR-005 §4.1) is the durable linked-data store for briefs, debriefs, agent artefacts, and — after ADR-009 — external-agent message receipts. The slot currently offers three implementation classes:

| Class | Implementation | Reality today |
|-------|----------------|---------------|
| `local-jss` (removed 2026-04-25) | HTTP client at `localhost:8484` | Was a Python `http.server` stub (`scripts/solid-pod-server.py`, 108 lines). GET/PUT/HEAD only. No WAC. No content negotiation. No PATCH. No LDP containers. Stub deleted; schema enum drops the label. |
| `external` | HTTP client at a configured base URL | Works correctly against any Solid-compliant server |
| `off` | `AdapterDisabled` | Works correctly |

The gap is visible at the source-tree level:

- `management-api/adapters/pods/local-jss.js` implements `write`, `read`, `patch` (JSON-patch), `del`, `list` with cursor pagination, and distinguishes 404 / 401 / 403 / other error classes. It was written to target a real Solid server.
- `scripts/solid-pod-server.py` serves only `GET`, `HEAD`, `PUT`. `DELETE`, `PATCH`, content negotiation, and container listing all return 404 or 405.

This means every adapter call beyond `read` and `write` silently fails in the default standalone configuration. The adapter contract test harness at `tests/contract/pods.contract.spec.js` only exercises `read` + `write` against the local implementation, hiding the discrepancy.

### What changed upstream

DreamLab-AI published [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) at v0.4.0-alpha.1 (2026-04):

| Capability | Coverage |
|------------|----------|
| Solid Protocol 0.11 | LDP resources + containers, strong SHA-256 ETags, If-Match / If-None-Match, range requests |
| WAC (2022-11-08) | Deny-by-default evaluation, `acl:default` inheritance, optional origin enforcement |
| PATCH | N3 Patch, SPARQL-Update, JSON Patch |
| Content negotiation | Turtle, JSON-LD, N-Triples |
| Auth — NIP-98 | Timestamp-bound event verification, optional BIP-340 Schnorr signature check (`nip98-schnorr` feature) |
| Auth — Solid-OIDC 0.1 | OAuth with DPoP proof-of-possession (`oidc` feature, optional) |
| Notifications 0.2 | WebSocket + Webhook channels; SolidOS-compatible legacy adapter available |
| Storage backends | `fs-backend` (POSIX + `.meta` + `.acl` sidecars, atomic rename), `memory-backend` (tests), `s3-backend` (AWS / MinIO / R2 / B2) |
| Deployment | Single static binary ≤40 MB (full), ≤200 KB (minimal NIP-98 only) |
| Library surface | Framework-agnostic Rust crate; actix-web reference server binary |
| Config | JSS-compatible env namespace (`JSS_HOST`, `JSS_PORT`, `JSS_STORAGE_ROOT`, …); JSON or TOML file; precedence compiled → file → env |
| Licence | AGPL-3.0-only (inherited from JavaScriptSolidServer) |

### JSS Rust crate lineage

The `JSS_*` env namespace and the v0.4-compat feature flag are the
visible footprint of the JSS Rust work the team developed in earlier
sprints. That codebase was consolidated into `solid-pod-rs` rather
than maintained as a separate `jss-rust` flake input — every JSS Rust
capability ships as a Cargo feature in `lib/solid-pod-rs.nix`:

| JSS capability | solid-pod-rs feature | Default? |
|---|---|---|
| did:nostr resolver | `did-nostr` | on |
| NIP-98 HTTP auth (BIP-340 Schnorr) | `nip98-schnorr` | on |
| Signed outbound webhooks | `webhook-signing` | on |
| Per-pubkey rate limiting | `rate-limit` | on |
| Per-pod byte quotas | `quota` | on |
| JSS v0.4 wire compat | `jss-v04` | on |
| ACL origin enforcement | `acl-origin` | on |
| Solid-OIDC 0.1 + DPoP | `oidc`, `dpop-replay-cache` | opt-in via manifest |
| S3 storage backend | `s3-backend` | opt-in via manifest |

A placeholder `sovereign_mesh.jss_rust_backend` boolean was added in
M4 (commit `44a59694`) anticipating a separate Rust pod input. When
solid-pod-rs landed as the canonical implementation, the placeholder
became dead config — the `jss-rust` flake input it gated was never
declared. The field, its schema entry, the wizard checkbox, and
validator rule E015 were retired on 2026-04-25 (commit `32b521ec`).
**No JSS Rust capability was lost in that cleanup** — every feature
above is built into the agentbox image as part of the default
`solid-pod-rs` build.

### Why this matters for agentbox

Four of agentbox's in-flight commitments quietly depend on capabilities the Python stub does not provide:

1. **ADR-009 / DDD-003 pod mailbox invariants** — I01 (signature-before-write), I08 (content-addressed by event id), and the atomic-rename durability story all assume the filesystem layer gives us `rename` semantics and WAC gates. The Python stub provides neither. solid-pod-rs's `fs-backend` is atomic-rename by design.
2. **WAC enforcement of `.acl.json` files** — `sovereign-bootstrap.py` writes per-pod ACL documents, but the Python server ignores them. A real Solid server applies them automatically.
3. **NIP-98 HTTP auth with Schnorr** — `mcp/servers/nostr-bridge.js` already has `verifyNip98()` with full constant-time Schnorr verification. The Python stub's header-prefix check is trivially bypassable. solid-pod-rs's `nip98-schnorr` feature matches our existing library-side validator.
4. **LDP container listing** — `local-jss.js` calls `list()` expecting a Solid container document with `@graph` members. The Python stub returns a flat directory listing JSON blob. This is an undetected contract violation.

## Licence analysis

Agentbox is AGPL-3.0; solid-pod-rs is AGPL-3.0-only. Two interaction modes need to be distinguished:

### Binary aggregation (preferred)

Running `solid-pod-rs-server` as a supervisord program inside the agentbox OCI image is **aggregation** under GPL/AGPL terminology: two independent works distributed on the same medium. AGPL §5 explicitly permits this:

> A compilation of a covered work with other separate and independent works… which are not by their nature extensions of the covered work, and which are not combined with it such as to form a larger program, in or on a volume of a storage or distribution medium, is called an "aggregate" if the compilation and its resulting copyright are not used to limit the access or legal rights of the compilation's users beyond what the individual works permit.

Both the agentbox image and the solid-pod-rs binary are AGPL-3.0. We must:

- Ship the AGPL source (or a written offer) alongside the image — satisfied by the nixpkgs derivation pulling from the public GitHub repo.
- Preserve the upstream `LICENSE` file in `/opt/agentbox/third-party/solid-pod-rs/LICENSE`.
- Not strip the AGPL notice from the binary.
- Honour AGPL §13: anyone with network access to the pod must be able to obtain the source. The upstream repository URL is enough provided we expose it in the NIP-11 equivalent metadata document (e.g. `/` returns a pointer to `https://github.com/DreamLab-AI/solid-pod-rs`).

### Library linking (rejected)

Linking `solid-pod-rs` as a Rust crate inside `management-api` or any other agentbox service would make the combined work a derivative of an AGPL-covered work. All first-party Rust code that links it would become AGPL. Agentbox's management-api is JavaScript so this does not arise today, but a future Rust rewrite must not embed the crate in-process.

**Decision:** use the binary only. Treat the library surface as off-limits for agentbox source.

## Decision

`local-solid-rs` is **the only first-party `pods` implementation**. The legacy `local-jss` Python stub was removed on 2026-04-25; the schema enum no longer accepts it (manifests carrying it now fail E016 schema validation).

```toml
[adapters]
pods = "local-solid-rs"   # first-class | external | off
```

Schema, validator, adapter, flake derivation, contract-test matrix, and documentation all treat `local-solid-rs` as **the** path; `external` federates with a host-provided Solid server; `off` returns `AdapterDisabled`. Agentbox's pod is a Rust Solid Protocol 0.11 server in every shipped configuration that uses pods at all.

`solid-pod-rs-server` is built from `github:DreamLab-AI/solid-pod-rs` (pinned `main@7f8bc89`, Sprint 9) through [`lib/solid-pod-rs.nix`](../../../lib/solid-pod-rs.nix). Because upstream at this rev does not ship a `Cargo.lock`, agentbox vendors one at [`lib/solid-pod-rs.cargo-lock`](../../../lib/solid-pod-rs.cargo-lock) (regenerated via `cargo generate-lockfile` after each rev bump; documented inline in the derivation). buildRustPackage uses `cargoLock.lockFile` against this vendored copy and `postPatch` copies it into the source tree before `cargoBuildHook` runs.

`buildAndTestSubdir = "crates/solid-pod-rs-server"` builds only the server binary; library features that the server crate doesn't forward are activated via cargo's `solid-pod-rs/<feature>` workspace-dep-path syntax in `defaultFeatures`.

### Configuration surface

```toml
[adapters]
pods = "local-solid-rs"

[sovereign_mesh]
solid_pod = true                # existing gate, unchanged

[integrations.solid_pod_rs]
port        = 8484              # JSS-compatible default for drop-in replacement
bind        = "127.0.0.1"
storage     = "fs"              # fs | memory | s3
storage_root = "/var/lib/solid" # unchanged mount path
base_url    = "http://127.0.0.1:8484"
enable_oidc = false             # Cargo feature 'oidc' — off by default
enable_schnorr_verify = true    # Cargo feature 'nip98-schnorr' — matches nostr-bridge
enable_dpop_cache = false       # 'dpop-replay-cache' — only with OIDC
notifications = "websocket"     # websocket | webhook | off
log_level   = "info"
```

### Adapter client

`management-api/adapters/pods/local-solid-rs.js` extends a private base class in `management-api/adapters/pods/_solid-http-base.js` (renamed from the old `local-jss.js` filename in commit `32b521ec`; the underscore prefix marks it as internal-only — it is **not** a manifest-selectable impl). The base class encodes generic Solid HTTP client semantics (PUT/GET/PATCH/DELETE, JSON-LD container parsing, typed 401/403/404 errors) and is shared with `external.js`. The `local-solid-rs` impl overrides `impl = "local-solid-rs"`, prefers LDP `Link: <…>; rel="next"` headers for cursor pagination, supports N3 patch via the capability probe at `OPTIONS /`, and reports the contract version explicitly.

### Validator rules

- **E032** — `adapters.pods = "local-solid-rs"` requires `integrations.solid_pod_rs.storage_root` to point at a writable path. The `[security.exceptions.solid-pod-rs]` block must carry `writable_volumes = ["solid-data:/var/lib/solid"]` (raised as E021 if the exception is missing — renamed from W021 in commit `ffc686a5` to match its blocking semantic).
- **E033** — `integrations.solid_pod_rs.enable_dpop_cache = true` without `enable_oidc = true` is an error (DPoP is OIDC-only).
- ~~**W034**~~ retired 2026-04-25. The `local-jss` deprecation warning was removed when the schema enum dropped the value; manifests carrying it now fail E016 schema validation outright.

### Supervisor block

```nix
# flake.nix (inside supervisorText generator, gated on adapters.pods == "local-solid-rs")
[program:solid-pod]
command=${solidPodRsPkg}/bin/solid-pod-rs-server \
  --config /etc/agentbox/solid-pod-rs.toml
directory=${solidPodRsDataDir}
environment=HOME="/workspace",\
  JSS_HOST="${relayCfg.bind}",\
  JSS_PORT="${toString (solidPodRsCfg.port or 8484)}",\
  JSS_STORAGE_ROOT="${solidPodRsCfg.storage_root or "/var/lib/solid"}",\
  JSS_BASE_URL="${solidPodRsCfg.base_url}",\
  RUST_LOG="${solidPodRsCfg.log_level or "info"}",\
  AGENTBOX_REQUIRED_FOR_READINESS="true"
autostart=true
autorestart=true
priority=30
stdout_logfile=/var/log/solid-pod.log
stderr_logfile=/var/log/solid-pod.error.log
```

Priority `30` matches the existing `solid-pod` supervisor block — unchanged so that ruvector (10) and management-api (20) still start first.

### Interaction with ADR-009 pod-inbox bridge

The Nostr bridge currently writes directly to the filesystem under `pods/<npub>/events/inbox/<id>.json` (ADR-009 §Routing layer). With solid-pod-rs live, two options:

| Path | Pros | Cons |
|------|------|------|
| **Direct filesystem write** (keep) | Same volume, atomic-rename semantics now *genuinely* atomic, no loopback auth cost | Bypasses WAC enforcement and Solid Notifications |
| Loopback HTTP PUT through solid-pod | WAC fires, Notifications fire naturally, visible in OTLP as pod spans | Bridge must NIP-98-sign on loopback for its own events; slower |

**Decision:** keep direct filesystem writes as canonical (invariant I01 / I08 preserved via `rename(2)` atomicity). Emit a **side-channel WebSocket notification** to solid-pod-rs's Solid Notifications 0.2 channel so external subscribers still see inbox events. This preserves performance on the hot path and satisfies the observability promise.

### Migration from local-jss (legacy)

Operators upgrading from a pre-2026-04-25 manifest:

1. Replace `pods = "local-jss"` with `pods = "local-solid-rs"`.
2. Ensure `[security.exceptions.solid-pod-rs]` is present with `writable_volumes = ["solid-data:/var/lib/solid"]`.
3. `./agentbox.sh rebuild`.

Both implementations stored under `/var/lib/solid`, so `agentbox.sh backup` survives the swap without data migration. `.meta` and `.acl` sidecars are written fresh by `solid-pod-rs` on first write; legacy resources without sidecars are served with the default ACL (owner-only access).

Manifests still carrying `pods = "local-jss"` after the upgrade fail validation with E016 (unknown enum value) — the schema no longer accepts it.

### Validator semantics

- **W030** (Nostr relay `open` ingress) is advisory: printed to stderr, exit 0.
- **W021** (missing `[security.exceptions.<feature>]` block for an active feature) is a blocking error because the hardened baseline may be silently broken without the exception delta.

### Service-level objectives

Inherits the ADR-005 §SLO targets for the `pods` slot (write p95 300 ms, read p95 150 ms). `solid-pod-rs`'s filesystem backend is expected to beat these comfortably on a sandboxed tmpfs; the contract test harness `tests/contract/pods.contract.spec.js` will be extended with:

- **`pods_patch_json_roundtrip`** — PUT + JSON-patch + GET asserts diff applied, p95 < 250 ms.
- **`pods_wac_deny_unauthenticated`** — unauthenticated PUT without `.acl.json` `acl:default` permission returns 401.
- **`pods_list_cursor_pagination`** — 300 members across 3 pages, LDP `Link: rel="next"` traversal.
- **`pods_ldp_container_metadata`** — container GET returns `ldp:BasicContainer` type and `@graph` member list.
- **`pods_atomic_rename_under_concurrency`** — 100 concurrent PUTs to same URI converge on exactly one final body (property-based, `fast-check`).

The Python stub fails three of these immediately. The harness failure is tolerated during Phase 1 via a `pods.contract.impl.skip` hint — `local-jss` is not required to pass the new assertions.

## Consequences

### Positive

- **Contract honesty.** The adapter client has been ahead of the local server since Phase-0; adopting solid-pod-rs closes the gap without client rewrites.
- **WAC genuinely enforces.** `.acl.json` files written by `sovereign-bootstrap.py` stop being decorative.
- **Atomic-rename durability.** DDD-003 I01 / I08 land as real filesystem invariants, not hopeful prose.
- **Same-vendor alignment.** solid-pod-rs is a DreamLab-AI project; issue triage flows through the same tracker.
- **Nix packaging is straightforward.** `buildRustPackage` against a pinned git rev, like the existing `lib/codex-binary.nix` pattern.
- **Licence-compatible.** Both components are AGPL-3.0; no aggregation analysis required. See `docs/developer/licensing.md`.
- **Unlocks S3 backend.** Federated pods become an infrastructure choice at runtime — no code change, just storage-driver flip.
- **Deterministic RDF.** solid-pod-rs emits stable Turtle serialisation; content-addressed pod storage becomes possible as a follow-up.

### Negative

- **Alpha upstream.** v0.4.0-alpha.1. API breakage is possible. Mitigation: pin by git rev, not semver range; track upstream's v0.5.0 (slated for Nostr integration) actively.
- **AGPL compliance burden.** We must preserve `LICENCE`, `NOTICE`, and an AGPL source-availability pointer. Adds a `docs/developer/licensing.md` maintenance task.
- **Hard cut on local-jss.** Operators with old manifests get an E016 on validate. The simplification is worth the migration nudge; the alternative was carrying two pod implementations indefinitely.
- **Cargo build cost on first image build.** Adds ~5-10 minutes to the Nix build closure on a cold cache. Acceptable given agentbox already compiles `rustToolchain` and codex; incremental cost is moderate.
- **S3 feature gate** is optional but its presence in the binary lifts the minimum image size from ~200 KB to ~40 MB (full features). We compile with `--features fs-backend,nip98-schnorr` by default.

## Alternatives considered

**Keep the Python stub.** Rejected: the adapter client already expects Solid Protocol 0.11 semantics that the stub cannot deliver; the LDP container listing contract is silently broken today.

**Hand-write a minimal Rust replacement.** Rejected: reinvents LDP container semantics, WAC evaluation, notifications, and atomic-rename storage. solid-pod-rs is a first-party project under the same org; maintenance overhead is shared.

**Adopt a different Solid server (Node — Community Solid Server, or Python — pysolid).** Rejected: Node pulls heavy runtime dependencies that agentbox already sandboxes elsewhere; pysolid is pre-alpha. solid-pod-rs's single-binary output matches agentbox's reproducible-artefact principle.

**Link solid-pod-rs as a Rust library inside a future management-api Rust rewrite.** Rejected for AGPL reasons — the combined work would become AGPL, infecting every Rust-side first-party component. Binary aggregation is the clean boundary.

**Flip the default immediately (breaking).** Rejected: operators with existing `/var/lib/solid` contents expect their current server to keep working. Phased deprecation (four phases, ~180 days) protects in-flight workloads.

**Skip solid-pod-rs until v1.0.0.** Rejected: the Python stub is already a blocker for ADR-009 correctness (direct filesystem writes are a workaround, not a solution). Adopting an alpha with a pinned rev is lower risk than shipping ADR-009 on top of a stub.

## Service-level objectives (delta)

No change to PRD-001 / ADR-005 SLOs; solid-pod-rs is expected to meet or beat them. Add these new assertions to `tests/contract/pods.contract.spec.js`:

| Assertion | Description | Target |
|-----------|-------------|--------|
| `pods_patch_n3_roundtrip` | N3 Patch applied and read back | p95 < 300 ms |
| `pods_wac_default_inheritance` | Writing to `container/child` inherits `container/.acl.json` `acl:default` | correctness |
| `pods_notifications_websocket_fanout` | PUT triggers WebSocket notification within 200 ms p95 | 200 ms |
| `pods_etag_concurrency` | If-Match with stale ETag returns 412 | correctness |
| `pods_cold_start` | supervisord → first 200 on `OPTIONS /` | ≤ 4 s |

## Contract test harness (merge gate)

Mandatory before this ADR moves from Proposed → Accepted. `tests/contract/pods.contract.spec.js` extended with the assertions above. Three implementation classes parameterised:

- `local-solid-rs` — must pass all.
- `local-jss` — legacy; runs only the original read/write assertions (skip-with-reason on new ones).
- `external` — runs the full suite against a configured external base URL.

Property-based tests via `fast-check`:

- PUT-then-GET convergence under concurrent writes (atomic rename).
- PATCH composition: apply(patch1, apply(patch0, x)) = apply(compose(patch0, patch1), x) for N3 and JSON-patch.

## Observability

No new first-party spans required — solid-pod-rs produces structured JSON logs by default and can emit OTLP spans when `RUST_LOG=debug` + `OTEL_EXPORTER_OTLP_ENDPOINT` is set. The bridge continues to emit its own `agentbox.adapter.pods.*` spans; solid-pod-rs spans layer underneath with the same trace id when the bridge injects the traceparent header on its HTTP calls.

New metrics (from solid-pod-rs, scraped via management-api proxy to keep a single `/metrics` surface):

- `solid_pod_rs_requests_total{method, status}` — counter
- `solid_pod_rs_wac_denied_total{reason}` — counter
- `solid_pod_rs_storage_bytes` — gauge (fs backend on-disk size)
- `solid_pod_rs_notifications_delivered_total{channel}` — counter

## Security

- Runs under the same `1000:1000` user, `read_only: true` baseline. Writable paths: `/var/lib/solid` only (same as today).
- New `[security.exceptions.solid-pod-rs]` block replaces the implicit volume that currently serves the Python stub. Same `writable_volumes = ["solid-data:/var/lib/solid"]` entry.
- NIP-98 with Schnorr is enabled by default (`nip98-schnorr` Cargo feature). Matches the existing `NostrBridge.verifyNip98` library. Both code paths verify; redundancy is acceptable during Phase 1-2 while the gateway story settles.
- Loopback binding by default. External exposure (e.g. a host orchestrator reaching the pod HTTP API) gated on `integrations.solid_pod_rs.bind = "0.0.0.0"` + validator rule analogous to E029.

## Follow-ups (non-blocking)

- `docs/developer/licensing.md` — canonical AGPL aggregation analysis with citation.
- `docs/user/pods-migration.md` — operator migration path from `local-jss` to `local-solid-rs`, including data-at-rest compatibility notes (both write to the same `/var/lib/solid` tree, different `.meta` sidecars).
- Nixpkgs upstreaming of `solid-pod-rs-server`. The crate is already on crates.io; a nixpkgs PR mirrors the nostr-rs-relay precedent and removes our `buildRustPackage` cost.
- `nostr-rs-relay` ↔ `solid-pod-rs` Notifications bridge: inbound Nostr event → Solid Notification on the recipient's pod `events/inbox/` collection. Natural ADR-009 extension.
- Evaluate `v0.5.0` when it ships; it targets first-party Nostr integration that may obviate custom bridge code in ADR-009.

## Related files

- `agentbox.toml` — new `[integrations.solid_pod_rs]` block; `pods` adapter enum extended
- `schema/agentbox.toml.schema.json` — new block + enum value
- `scripts/agentbox-config-validate.js` — E032-E034 / W034
- `scripts/start-agentbox.sh` — wizard section update
- `flake.nix` — `solidPodRsPkg` derivation via `buildRustPackage` + pinned rev; supervisor block variant
- `management-api/adapters/pods/local-solid-rs.js` — new adapter impl
- `tests/contract/pods.contract.spec.js` — extended assertions
- `scripts/solid-pod-server.py` — retained through Phase 3, then removed
- `docs/user/nostr-relay.md` — update pod-is-the-inbox note to reference the Rust server
- `docs/reference/prd/PRD-001-capabilities-and-adapters.md` — pod capability row updated
- `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md` — `local-jss` → `local-solid-rs | local-jss` in the implementation table

## Upstream absorption log (Sprint 5-9)

Upstream's `main` moved 8 commits past the `v0.4.0-alpha.1` tag after agentbox
first pinned it. The pin is now `main@7f8bc89` (Sprint 9 consolidation). The
version label in `lib/solid-pod-rs.nix` reads `0.4.0-alpha.1+sprint-9` to
flag the divergence until upstream cuts v0.5.0.

The absorbed sprints add five new Cargo features that are now **on by default**
because each either sharpens a sovereign-stack invariant or closes a P0 gap.

| Sprint | Upstream commit | Feature | Default | Effect on agentbox |
|--------|-----------------|---------|---------|--------------------|
| 5 | `bf15526` | DPoP + JWKS SSRF + alg-dispatch fixes | baseline | Tightens existing OIDC path; no manifest change required |
| 6 | `341f03c` | **`did-nostr`** — `did:nostr:<pubkey>` DID resolver (BIP-340 x-only hex; also accepts bech32 `npub` for Nostr-internal callers) with Tier 1 + Tier 3 conformance and `alsoKnownAs` cross-verification | **on** | Closes the identity loop. WAC policies can now be written against `did:nostr:<pubkey>` (a stable name) instead of raw hex pubkeys treated as opaque tokens, so pod ACLs speak the same identity surface that NIP-42 (relay) and NIP-98 (HTTP) speak. |
| 6 | `341f03c` | **WAC 2.0 conditions** — ACL document 2.0 grammar | baseline | Richer expressions (time windows, origin constraints) for the `.acl.json` files written by `sovereign-bootstrap.py` |
| 6 | `341f03c` | **`webhook-signing`** — RFC 9421 Ed25519 signing of outbound Solid Notification webhooks | on (when `notifications = "webhook"`) | Receivers can cryptographically verify event provenance; eliminates a class of webhook-spoofing attacks that previously required out-of-band TLS inspection |
| 7 | `ebbf163` | **`rate-limit`** — sliding-window LRU rate limiter, CORS policy knobs | on | Matches `nostr-rs-relay`'s `messages_per_sec` ceiling for coherence across the stack; new env vars `JSS_ENABLE_RATE_LIMIT`, `JSS_RATE_LIMIT_PER_SEC` |
| 7 | `ebbf163` | Multi-tenancy + route table | baseline | Groundwork for future per-profile pod-mounts inside one agentbox container (deferred; agentbox still uses one npub per container) |
| 8 | (in Sprint 9) | **`quota`** — per-pod storage ceilings via `.quota.json` sidecar with atomic writes | on | Hard floor on how much a single npub can persist into `/var/lib/solid`; new env vars `JSS_ENABLE_QUOTA`, `JSS_QUOTA_DEFAULT_BYTES` (default 10 GiB) |
| 9 | `2275146` | P0 security + WAC 2.0 conditions + pod bootstrap | baseline | Further hardening; no behaviour change visible to agentbox code |
| 9 | `7f8bc89` | Consolidation + agent integration guide | docs | Upstream now has an explicit "agent integration" track; agentbox is that integration |
| any | `/.well-known/solid`, WebFinger JRD | — | on | Standards-compliant discovery; the Solid service document at `GET /` now advertises the relay URL and `did:nostr` support |

### Implications for the sovereign data stack

**`did:nostr` is the important one.** Before Sprint 6, the sovereign stack spoke
three dialects of the same secp256k1 pubkey: raw hex (internal), `npub…` bech32
(Nostr wire), and a `webId` URI embedded in `pods/<npub>/profile.json`. Each
layer converted on the boundary. With `did-nostr`, the pod can answer
`GET /did:nostr:<pubkey>` and hand back a Tier 1 / Tier 3 DID document whose
`verificationMethod` is the same pubkey the relay accepted under NIP-42.

WAC policies can therefore be written as:

```json
{
  "@type": "Authorization",
  "agent": "did:nostr:npub1q…",
  "mode": ["Read", "Write"],
  "accessTo": "./events/inbox/"
}
```

— and the pod validates the signature against the same key the relay already
trusts. The npub is no longer a string that happens to appear in four places;
it is the resolvable identity the stack revolves around.

**`quota` hardens the pod-inbox bridge.** Before Sprint 8, a misbehaving
external agent could flood `pods/<npub>/events/inbox/` with gigabytes of
signed junk, and the only defence was `max_event_bytes` at the relay (which
limits a single event, not the cumulative). With `enable_quota = true`, each
pod has a `.quota.json` sidecar; writes past the ceiling return 413. Default
10 GiB per npub is far above any realistic mailbox size; operators can tune
via `quota_default_bytes`.

**`rate-limit` is the third coherence knob.** `nostr-rs-relay` already has
`messages_per_sec`; now the pod has a matching token bucket. External agents
cannot bypass relay limits by hitting the pod HTTP surface directly.

### Absorption cost

- **Nix build**: `lib/solid-pod-rs.nix` rev bumped to Sprint 9; both `srcHash`
  and `cargoHash` remain `lib.fakeHash` until an operator's first prefetch.
  Build time grows slightly because the extra Cargo features pull in a handful
  of dependencies (reqwest-eventsource, moka LRU, ed25519-dalek); closure size
  increase is <5 MB.
- **Manifest**: seven new keys under `[integrations.solid_pod_rs]`
  (`enable_did_nostr`, `enable_webhook_signing`, `enable_rate_limit`,
  `enable_quota`, `jss_v04_compat`, `rate_limit_per_sec`,
  `quota_default_bytes`). All default-on or sensible numeric defaults, so
  existing manifests keep working with no edits.
- **Contract test harness**: `tests/contract/pods.contract.spec.js` gains
  three new assertions: `pods_did_nostr_resolves_self`,
  `pods_quota_enforces_413`, `pods_rate_limit_returns_429`. Wired as
  follow-ups when the contract suite lands.

### Position in the sovereign data stack

`solid-pod-rs` is the pod half of the DreamLab-AI sovereign data stack. The other components are first-party agentbox features, first-party DreamLab-AI projects, or carefully vendored upstream pieces:

| Layer | Component | Ownership | Purpose |
|-------|-----------|-----------|---------|
| Identity | `sovereign-bootstrap.py` + secp256k1 keypair under `/var/lib/agentbox/identities/` | agentbox first-party | Each container owns its Nostr npub/nsec pair |
| Auth — HTTP | NIP-98 with Schnorr verification in `nostr-bridge.js` and `solid-pod-rs` | shared contract | Signed Nostr events carry HTTP requests |
| Auth — network | NIP-42 challenge on `nostr-rs-relay` | upstream (vendored by Nix) | External agents prove pubkey possession |
| Durable storage | **`solid-pod-rs`** — Solid Protocol 0.11, WAC, LDP, Notifications | **first-party (this ADR)** | Pods for briefs, debriefs, agent artefacts, event inbox/outbox |
| Messaging | `nostr-rs-relay` + pod-inbox bridge ([ADR-009](ADR-009-embedded-nostr-relay.md)) | vendored + first-party bridge | External ↔ internal agent messages |
| Privacy governance | `openai/privacy-filter` middleware ([ADR-008](ADR-008-privacy-filter-routing.md)) | vendored + first-party policy | PII redaction before adapter writes |

The stack is coherent because every layer speaks the same identity. With `did-nostr` absorbed from Sprint 6, that identity has a single canonical resolvable form: `did:nostr:<pubkey>` (ADR-013). The HTTP surface (NIP-98), the WebSocket surface (NIP-42), the pod's WAC policies, and the relay's allowlist all reference the same DID. An external agent that can sign a Nostr event can reach the relay, be identified by the pod, have its message persisted to a content-addressed mailbox bounded by a declared quota, and have its outbound notifications signed under RFC 9421 — no federated identity provider, no OAuth flow, no third-party broker.

`solid-pod-rs` is the piece that was missing: until this ADR, the stack had identity and messaging but its "durable" layer was a 108-line Python stub that ignored WAC. The promotion is not an optimisation — it closes the stack.
