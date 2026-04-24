# ADR-010: Rust Solid pod server adoption (solid-pod-rs)

**Status:** Proposed
**Date:** 2026-04-24
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-005 (Pluggable adapter architecture), ADR-006 (Immutable runtime bootstrap), ADR-007 (Runtime contract and container hardening), ADR-009 (Embedded Nostr relay and pod-inbox bridge), PRD-001 (Capabilities and adapters), PRD-004 (External agent messaging)

## TL;DR for newcomers
*Skip if you already know why the Python pod stub is a liability.*

This ADR proposes replacing the 108-line Python pod server at `scripts/solid-pod-server.py` with [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) — a Rust-native Solid Protocol 0.11 implementation (AGPL-3.0-only) recently published by DreamLab-AI. The pain point is that the Python stub only implements GET/PUT/HEAD, no WAC enforcement, no content negotiation, no LDP containers, no PATCH, and only a header-prefix check for NIP-98 — meanwhile the existing `management-api/adapters/pods/local-jss.js` client already expects full LDP semantics including JSON-patch, cursor-paginated container listing, and proper 401/403 responses. The shape of the answer is to **add a new `local-solid-rs` pod implementation alongside the existing `local-jss` label**, ship it as a binary under supervisord (not linked as a library — AGPL aggregation vs derivative rules), and deprecate the Python stub gradually. The [ADR-009 pod-inbox invariants](ADR-009-embedded-nostr-relay.md) (I01 signature-before-write, I08 content-addressed by event id) start to hold genuinely because solid-pod-rs provides atomic-rename filesystem semantics.

**If you remember only one thing:** the Rust pod closes the gap between what the adapter client already expects and what the server actually delivers.

For the deep version, keep reading.

## Context

### Current state

The `pods` adapter slot (ADR-005 §4.1) is the durable linked-data store for briefs, debriefs, agent artefacts, and — after ADR-009 — external-agent message receipts. The slot currently offers three implementation classes:

| Class | Implementation | Reality today |
|-------|----------------|---------------|
| `local-jss` | HTTP client at `localhost:8484` | **Python `http.server` stub** (`scripts/solid-pod-server.py`, 108 lines). GET/PUT/HEAD only. No WAC (header prefix check only). No content negotiation. No PATCH. No LDP containers. |
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

### Why this matters for agentbox

Four of agentbox's in-flight commitments quietly depend on capabilities the Python stub does not provide:

1. **ADR-009 / DDD-003 pod mailbox invariants** — I01 (signature-before-write), I08 (content-addressed by event id), and the atomic-rename durability story all assume the filesystem layer gives us `rename` semantics and WAC gates. The Python stub provides neither. solid-pod-rs's `fs-backend` is atomic-rename by design.
2. **WAC enforcement of `.acl.json` files** — `sovereign-bootstrap.py` writes per-pod ACL documents, but the Python server ignores them. A real Solid server applies them automatically.
3. **NIP-98 HTTP auth with Schnorr** — `mcp/servers/nostr-bridge.js` already has `verifyNip98()` with full constant-time Schnorr verification. The Python stub's header-prefix check is trivially bypassable. solid-pod-rs's `nip98-schnorr` feature matches our existing library-side validator.
4. **LDP container listing** — `local-jss.js` calls `list()` expecting a Solid container document with `@graph` members. The Python stub returns a flat directory listing JSON blob. This is an undetected contract violation.

## Licence analysis

Agentbox is MPL-2.0; solid-pod-rs is AGPL-3.0-only. Two interaction modes need to be distinguished:

### Binary aggregation (preferred)

Running `solid-pod-rs-server` as a supervisord program inside the agentbox OCI image is **aggregation** under GPL/AGPL terminology: two independent works distributed on the same medium. AGPL §5 explicitly permits this:

> A compilation of a covered work with other separate and independent works… which are not by their nature extensions of the covered work, and which are not combined with it such as to form a larger program, in or on a volume of a storage or distribution medium, is called an "aggregate" if the compilation and its resulting copyright are not used to limit the access or legal rights of the compilation's users beyond what the individual works permit.

The agentbox image remains MPL-2.0; the solid-pod-rs binary remains AGPL-3.0. We must:

- Ship the AGPL source (or a written offer) alongside the image — satisfied by the nixpkgs derivation pulling from the public GitHub repo.
- Preserve the upstream `LICENSE` file in `/opt/agentbox/third-party/solid-pod-rs/LICENSE`.
- Not strip the AGPL notice from the binary.
- Honour AGPL §13: anyone with network access to the pod must be able to obtain the source. The upstream repository URL is enough provided we expose it in the NIP-11 equivalent metadata document (e.g. `/` returns a pointer to `https://github.com/DreamLab-AI/solid-pod-rs`).

### Library linking (rejected)

Linking `solid-pod-rs` as a Rust crate inside `management-api` or any other agentbox service would make the combined work a derivative of an AGPL-covered work. All first-party Rust code that links it would become AGPL. Agentbox's management-api is JavaScript so this does not arise today, but a future Rust rewrite must not embed the crate in-process.

**Decision:** use the binary only. Treat the library surface as off-limits for agentbox source.

## Decision (proposed)

Add a fourth implementation class to the `pods` adapter slot:

```toml
[adapters]
pods = "local-solid-rs"   # new  | local-jss (legacy) | external | off
```

Ship `solid-pod-rs-server` as a pinned Nix derivation built from `github:DreamLab-AI/solid-pod-rs` at a tagged release (initially `v0.4.0-alpha.1`). Replace the `[program:solid-pod]` supervisord block's command when `local-solid-rs` is active; leave the Python stub in place for `local-jss` during a deprecation window.

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

### Adapter client changes

`management-api/adapters/pods/local-solid-rs.js` — new file, derived from `local-jss.js`. The HTTP contract is identical, so the bulk of the diff is the `impl` string. Add:

- Header `Accept-Patch: application/json-patch+json, text/n3, application/sparql-update` to advertise patch dialects.
- Capability probe on first call: `OPTIONS /` returns `Accept-Patch` and `Accept-Post`; cache capability map in the adapter for idempotency checks.
- Cursor format: solid-pod-rs uses `Link: <…>; rel="next"` headers (LDP-paged). Update `list()` to prefer Link over the previous `_cursor` JSON-body field. Keep the fallback for `local-jss` callers during the deprecation window.

`local-jss.js` **remains unchanged**. Its `_cursor` body field path still works because the Python stub returns flat JSON — it always returned `cursor: null`.

### Validator rules

Adds:

- **E032** — `adapters.pods = "local-solid-rs"` requires `integrations.solid_pod_rs.storage_root` to point at a writable path. The `[security.exceptions.solid-pod-rs]` block must carry `writable_volumes = ["solid-data:/var/lib/solid"]`.
- **E033** — `integrations.solid_pod_rs.enable_dpop_cache = true` without `enable_oidc = true` is an error (DPoP is OIDC-only).
- **W034** — `adapters.pods = "local-jss"` emits a deprecation warning once `local-solid-rs` is available (warn but don't fail, to permit the deprecation window).

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

### Deprecation schedule

| Phase | Duration | Behaviour |
|-------|----------|-----------|
| Phase 1 (this ADR lands) | 60 days | `local-solid-rs` added; `local-jss` default unchanged; W034 warning when `local-jss` is selected on a fresh manifest; migration doc in `docs/user/pods-migration.md` |
| Phase 2 | next release | Default flips: fresh wizard picks `local-solid-rs`; existing manifests still resolve `local-jss` without warning |
| Phase 3 | 90 days after Phase 2 | `local-jss` still works; W034 escalates to E034 on new manifests but legacy manifests are grandfathered |
| Phase 4 | subsequent major release | `scripts/solid-pod-server.py` removed; `local-jss` removed from schema; migration tool `agentbox.sh pods migrate-to-rs` ships |

Backup format: `agentbox.sh backup` already captures `/var/lib/solid` as a directory tarball. Both implementations store under the same mount; backup/restore survives the swap without changes.

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
- **Licence-compatible.** Binary aggregation under AGPL §5 keeps agentbox MPL-2.0; documented in the new `docs/developer/licensing.md`.
- **Unlocks S3 backend.** Federated pods become an infrastructure choice at runtime — no code change, just storage-driver flip.
- **Deterministic RDF.** solid-pod-rs emits stable Turtle serialisation; content-addressed pod storage becomes possible as a follow-up.

### Negative

- **Alpha upstream.** v0.4.0-alpha.1. API breakage is possible. Mitigation: pin by git rev, not semver range; track upstream's v0.5.0 (slated for Nostr integration) actively.
- **AGPL compliance burden.** We must preserve `LICENCE`, `NOTICE`, and an AGPL source-availability pointer. Adds a `docs/developer/licensing.md` maintenance task.
- **Two pod implementations during deprecation.** Phase 1-3 operators can land in a mixed state. Contract harness must explicitly label assertions as "requires local-solid-rs" vs "works on any impl".
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

## Decision pending

Accept this ADR to trigger the Phase-1 implementation (≈ 2 days of work: flake derivation, new adapter impl, validator rules, wizard section, contract-test assertions, user + licensing docs). Redirect with a new preference if the licence coupling or alpha pinning is unacceptable — alternatives section lists four other paths.
