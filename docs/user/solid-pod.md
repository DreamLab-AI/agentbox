# Solid pod — the durable half of the sovereign data stack

Agentbox's `pods` adapter slot is backed by a first-party Rust Solid Protocol
0.11 server, [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs).
It is the durable-storage layer of the
[sovereign data stack](../../README.md#sovereign-data-stack) — a coherent
identity-plus-data substrate that lets external agents reach internal ones,
and lets internal agents persist their state, without any third-party broker.

Canonical spec: [ADR-010](../reference/adr/ADR-010-rust-solid-pod-adoption.md).

## Why this matters

A pod holds everything durable an agent produces or receives: briefs,
debriefs, artefacts, system prompts, **and** the inbox/outbox mailboxes
that back [ADR-009 external-agent messaging](../reference/adr/ADR-009-embedded-nostr-relay.md).
Every `pods/<npub>/events/inbox/<id>.json` entry is a verified Nostr event;
every `events/outbox/<id>.json` is a signed outbound message waiting to
fan out.

Until solid-pod-rs became first-class, the `pods` slot resolved to a 108-line
Python stub that accepted every authenticated request. WAC policies written
by `sovereign-bootstrap.py` were decorative. Container listing returned a
flat directory index instead of an LDP Basic Container. Atomic-rename
durability (DDD-003 invariants I01 and I08) did not hold. **solid-pod-rs
closes that gap.** It ships the full Solid 0.11 surface the existing
client (`management-api/adapters/pods/local-solid-rs.js`) has expected since day one.

solid-pod-rs is also the home of the JSS Rust crates the team built in
earlier sprints (did:nostr, NIP-98 Schnorr, webhook signing, rate-limit,
quota, JSS v0.4 wire compat). Those features are not a separate codebase
to maintain — they ship as Cargo features on this single binary. The
`JSS_*` env-var prefix you'll see in `docker exec agentbox env` is
deliberate backwards compatibility for anyone who learned the older API.

## What you get

| Capability | solid-pod-rs (Sprint 9) |
|------------|--------------------------|
| LDP resources + Basic Containers | yes |
| Web Access Control — WAC 2.0 conditions (Sprint 6) | deny-by-default + `acl:default` inheritance + time windows + origin constraints |
| PATCH dialects | N3 Patch, SPARQL-Update, JSON Patch |
| Content negotiation | Turtle, JSON-LD, N-Triples |
| NIP-98 HTTP auth | full Schnorr signature verification |
| `did:nostr` resolver (Sprint 6) | Tier 1 + Tier 3 with `alsoKnownAs` cross-verification |
| RFC 9421 webhook signing (Sprint 6) | Ed25519 signatures on outbound Solid Notifications |
| Rate limiting (Sprint 7) | sliding-window LRU, tunable per-connection ceiling |
| Per-pod storage quota (Sprint 8) | `.quota.json` sidecar with atomic writes; 413 on overflow |
| Solid-OIDC with DPoP | optional feature gate |
| Solid Notifications 0.2 | WebSocket + Webhook channels |
| `/.well-known/solid` + WebFinger JRD | standards-compliant discovery |
| Storage backends | filesystem (atomic rename), memory (tests), S3/MinIO/R2/B2 |
| Strong ETags | SHA-256; If-Match, If-None-Match, range requests |
| Licence | AGPL-3.0-only (binary aggregation; see [licensing.md](../developer/licensing.md)) |
| Binary size | ≤40 MB full features, ≤200 KB minimal |

The 2026-04-25 cleanup removed the Python `local-jss` stub entirely. There is
no second pod implementation in agentbox; either you use `local-solid-rs`,
you federate with `external`, or you turn the slot `off`.

## When to skip this

- You have a host-provided Solid server you want agentbox to federate with.
  Set `adapters.pods = "external"` and `federation.mode = "client"`.
- You have a workload that writes nothing durable. Set `adapters.pods = "off"`.

If you have an old manifest with `pods = "local-jss"`, validation will fail
with E016 (unknown enum value). Flip it to `local-solid-rs` — both the
legacy stub and the Rust server stored under `/var/lib/solid`, so existing
data carries across without migration.

## Wizard flow

`scripts/start-agentbox.sh` asks one question for the `pods` slot. Pick from:

- **`local-solid-rs`** (default) — the Rust server described here
- `external` — a host-provided Solid server (requires `federation.mode="client"` + `federation.external_url`)
- `off` — no pod storage; consumers receive `AdapterDisabled`

`local-jss` is no longer offered.

## Manifest reference

```toml
[adapters]
pods = "local-solid-rs"   # first-class default

[integrations.solid_pod_rs]
port                   = 8484
bind                   = "127.0.0.1"
storage                = "fs"                # fs | memory | s3
storage_root           = "/var/lib/solid"
base_url               = "http://127.0.0.1:8484"
enable_oidc            = false
enable_schnorr_verify  = true                # matches nostr-bridge.js verifyNip98
enable_dpop_cache      = false               # requires enable_oidc=true (E033)
notifications          = "websocket"         # websocket | webhook | off
log_level              = "info"
# Sprint 5-9 features absorbed from upstream main:
enable_did_nostr       = true                # did:nostr:<npub> → WebID resolver
enable_webhook_signing = true                # RFC 9421 Ed25519 on outbound webhooks
enable_rate_limit      = true                # sliding-window LRU
enable_quota           = true                # per-pod storage ceiling
jss_v04_compat         = true                # JSS v0.4 config/behaviour compat
rate_limit_per_sec     = 20                  # per-connection token-bucket ceiling
quota_default_bytes    = 10737418240         # 10 GiB default quota per pod

[security.exceptions.solid-pod-rs]
writable_volumes = ["solid-data:/var/lib/solid"]
reason = "solid-pod-rs fs-backend requires atomic-rename writable storage under /var/lib/solid"
```

Validator rules that watch this section:

| Code | Condition |
|------|-----------|
| **E033** | `enable_dpop_cache=true` requires `enable_oidc=true` (DPoP is OIDC-only). |
| **W021** | Feature active without `[security.exceptions.solid-pod-rs]` — the hardened baseline blocks writes to `/var/lib/solid` otherwise. |

## Verify it's running

```sh
# Container-internal
docker exec agentbox supervisorctl status solid-pod
docker exec agentbox curl -s http://127.0.0.1:8484/ | head -20

# NIP-11-style relay discovery doc at /
curl -s http://<host>:8484/ | jq '."http://www.w3.org/ns/solid/terms#ServiceResource"'

# Writing through WAC requires a NIP-98 Authorization header signed with your
# container's npub — the NostrBridge.verifyNip98() library in management-api
# produces this. Try a write via an internal agent first, then verify it lands:
ls /workspace/profiles/default/pods/<your-npub>/
```

Container health is aggregated into `/health/pods` on the management-api:

```sh
curl -s http://localhost:9090/health/pods | jq
```

## did:nostr — the identity loop

After the Sprint 6 absorption, the pod serves a Tier 1 / Tier 3 DID document
at `GET /did:nostr:<your-npub>`:

```sh
curl -s http://127.0.0.1:8484/did:nostr:npub1q…abcd | jq
# {
#   "@context": "https://www.w3.org/ns/did/v1",
#   "id": "did:nostr:npub1q...abcd",
#   "verificationMethod": [{
#     "id": "did:nostr:npub1q...abcd#key-0",
#     "type": "SchnorrSecp256k1VerificationKey2022",
#     "controller": "did:nostr:npub1q...abcd",
#     "publicKeyHex": "<32-byte schnorr pubkey>"
#   }],
#   "alsoKnownAs": [
#     "http://127.0.0.1:8484/pods/npub1q...abcd/profile.json"
#   ]
# }
```

Rather than writing WAC policies against raw hex pubkeys, you can now
reference the DID:

```json
{
  "@type": "Authorization",
  "agent": "did:nostr:npub1q…abcd",
  "mode": ["Read", "Write"],
  "accessTo": "./events/inbox/"
}
```

The pod validates signatures against the same key the relay accepted under
NIP-42. One identity surface across the whole sovereign data stack.

## The sovereign data stack in one picture

```mermaid
flowchart LR
    subgraph identity["Identity layer"]
        ID["sovereign-bootstrap.py<br/>secp256k1 keypair"]
    end
    subgraph pod["solid-pod-rs (:8484)"]
        POD["LDP + WAC + Notifications"]
        MBOX["pods/&lt;npub&gt;/events/<br/>{inbox,outbox}/&lt;id&gt;.json"]
        POD --> MBOX
    end
    subgraph relay["nostr-rs-relay (:7777)"]
        REL["NIP-42 AUTH<br/>NIP-01 events"]
    end
    subgraph privacy["opf-router (:9092)"]
        OPF["PII redaction<br/>middleware"]
    end
    subgraph agents["Internal agents"]
        AG["Claude Code · ruflo · Codex · Antigravity"]
    end
    EXT["External agent"] -->|"signed event + NIP-42"| REL
    REL -->|"verified event"| MBOX
    AG -->|"write"| OPF
    OPF -->|"redacted write"| POD
    AG -->|"outbound event"| MBOX
    MBOX -->|"outbox flush"| REL
    REL -->|"NOSTR_RELAYS fan-out"| EXT
    ID -.->|"signs for"| POD
    ID -.->|"signs for"| REL
```

Four loopback ports. One sovereign identity. No external broker.

## Storage backends

Default is `fs` (POSIX filesystem under `/var/lib/solid`, atomic-rename
writes, `.meta` and `.acl` sidecars). Two alternatives:

- **`memory`** — in-process HashMap. Fine for tests, loses everything on
  restart. Do not use in production.
- **`s3`** — AWS S3, MinIO, Cloudflare R2, Backblaze B2. Federated pods
  without a separate Solid service. Configured via the `solid-pod-rs`
  upstream env vars (see [the upstream config
  docs](https://github.com/DreamLab-AI/solid-pod-rs)). Cargo feature
  `s3-backend` is added automatically when you set
  `integrations.solid_pod_rs.storage = "s3"`.

## Licence and aggregation

`solid-pod-rs` is AGPL-3.0-only (inherited from JavaScriptSolidServer to
preserve copyleft of the wider Solid ecosystem). Agentbox is AGPL-3.0. The
agentbox image ships `solid-pod-rs-server` as a **separate binary** under
supervisord, not as a linked library — both are uniformly AGPL-3.0. AGPL §5
still applies to the binary boundary:

> A compilation of a covered work with other separate and independent
> works… is called an "aggregate" if the compilation and its resulting
> copyright are not used to limit the access or legal rights of the
> compilation's users beyond what the individual works permit.

Full analysis: [`docs/developer/licensing.md`](../developer/licensing.md).

## Further reading

- [ADR-010 — solid-pod-rs as first-class pod server](../reference/adr/ADR-010-rust-solid-pod-adoption.md)
- [ADR-009 — Embedded Nostr relay and pod-inbox bridge](../reference/adr/ADR-009-embedded-nostr-relay.md)
- [DDD-003 — Sovereign messaging domain](../reference/ddd/DDD-003-sovereign-messaging-domain.md) (pod mailbox invariants I01, I08)
- [ADR-005 — Pluggable adapter architecture](../reference/adr/ADR-005-pluggable-adapter-architecture.md)
- [Developer: sovereign mesh internals](../developer/sovereign-mesh.md)
- [solid-pod-rs upstream](https://github.com/DreamLab-AI/solid-pod-rs)
- [AGPL aggregation analysis](../developer/licensing.md)
- [Native pod sidecar + Cloudflare Tunnel setup](native-solid-pod.md)
