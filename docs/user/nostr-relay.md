# Nostr relay — how external agents reach internal ones

Agentbox can run an embedded Nostr relay so external humans and agents can
send signed, authenticated messages to the agents running inside your
container, and so internal agents can publish durable, auditable messages
back out. The decision and contract are specified in
[ADR-009](../reference/adr/ADR-009-embedded-nostr-relay.md) and
[PRD-004](../reference/prd/PRD-004-external-agent-messaging.md); the
domain model lives in
[DDD-003](../reference/ddd/DDD-003-sovereign-messaging-domain.md).

## Why this exists

Before the relay, agentbox was a one-way Nostr client. It could publish
events to public relays like `relay.damus.io` and subscribe to whatever
those relays served, but there was no way for an **external** agent to
reliably address an **internal** one. The scaffolding directories
`pods/<npub>/events/{inbox,outbox}/` were inert — nothing wrote to them.

The relay fixes three things at once:

- **Inbound addressing.** External agents sign an event with a `p` tag
  set to your container's npub, the relay accepts it under NIP-42 auth,
  and the bridge persists it to `pods/<npub>/events/inbox/<id>.json`.
- **Outbound durability.** Internal agents write to `events/outbox/`; the
  bridge signs and publishes; the outbox entry is stamped with the
  resulting event id. If publication fails it retries with
  exponential backoff. No silent drops.
- **Standalone mesh.** Two agentbox containers on the same network can
  gossip through either's embedded relay without trusting a public relay
  as a broker.

## When to skip this

- You only use agentbox for local development and never message other
  agentboxes. Keep `enabled = false`.
- You federate with a host project that already provides a relay. Use
  `implementation = "external"` and point at the host endpoint.
- You want the sovereign identity for NIP-98 HTTP auth but no messaging.
  Keep `sovereign_mesh.nostr_bridge = true` but `sovereign_mesh.relay.enabled = false`.

## The wizard flow

`scripts/start-agentbox.sh` only surfaces the relay question when the
sovereign mesh is already enabled. You will see four dialogs in sequence:

1. **Implementation** — `nostr-rs-relay` (default, SQLite, in nixpkgs),
   `rnostr` (LMDB + full-text search, must be vendored), `external`
   (host-provided), or `off`.
2. **Network binding** — `loopback` (safest; only the in-container bridge
   can read), `host-expose` (publishes the port so external agents can
   connect from outside Docker), `docker-net` (reachable from sibling
   containers on the same docker network, not from the host).
3. **Ingress policy** — `allowlist` (safest; NIP-42 AUTH + pubkey on the
   allowed list), `signed-only` (NIP-42 AUTH; any valid signer), `open`
   (no AUTH; homelab mode; raises validator warning W030).
4. **External fanout** — `off` (air-gapped mesh), `publish-only`,
   `subscribe-only`, `bidirectional`.

The wizard also asks for retention in days.

## The pod is the inbox

Every signature-verified inbound event targeting your container's npub
is persisted to:

```
pods/<npub>/events/inbox/<event-id>.json
```

Every outbound event starts life at:

```
pods/<npub>/events/outbox/<pending-id>.json      # status = "pending"
```

and is renamed to:

```
pods/<npub>/events/outbox/<final-event-id>.json  # status = "published"
```

once the bridge has signed and the embedded relay has acknowledged. If
all configured relays refuse the event, `status` becomes `"failed"` and
`attempts[]` records each retry.

This is the invariant that makes agentbox messaging *durable* and not
*best-effort*: **the pod is the source of truth**. The relay's SQLite
database is transport. If the relay is wiped but the pod survives, every
received message is still there.

The pod is served by [`solid-pod-rs`](solid-pod.md) — the first-party
Rust Solid Protocol 0.11 server ([ADR-010](../reference/adr/ADR-010-rust-solid-pod-adoption.md))
— using an atomic-rename filesystem backend. DDD-003 invariants I01
(signature-before-write) and I08 (content-addressed mailbox, no duplicates)
hold as real filesystem guarantees, not hopeful prose. The sovereign
data stack is coherent because every layer — identity, relay, pod,
privacy filter — speaks the same npub.

## Quick test (after enabling)

```sh
# From inside the container
curl -s http://localhost:7777/ -H 'Accept: application/nostr+json' | jq
# returns the NIP-11 relay information document

# Publish a test event via an external Nostr client pointed at
# ws://<host>:7777 — see your client's docs. The relay will only
# accept writes after NIP-42 AUTH unless ingress_policy = "open".

# Inspect the inbox
ls /workspace/profiles/default/pods/<your-npub>/events/inbox/
```

## Manifest reference

```toml
[sovereign_mesh.relay]
enabled          = true
implementation   = "nostr-rs-relay"   # nostr-rs-relay | rnostr | external | off
port             = 7777
bind             = "127.0.0.1"        # or "0.0.0.0" with expose=true
expose           = false              # publish port in docker-compose
data_dir         = "/var/lib/nostr-relay"
ingress_policy   = "allowlist"        # allowlist | signed-only | open
allowed_pubkeys  = []                 # empty = self only
allowed_kinds    = [1, 1059, 30078, 27235, 38000, 38100]
pod_bridge       = true
external_fanout  = "off"              # bidirectional | publish-only | subscribe-only | off
max_event_bytes  = 131072
messages_per_sec = 5
retention_days   = 30
allow_nip04      = false
info_description = "Agentbox sovereign relay"
info_contact     = ""

[security.exceptions.nostr-relay]
writable_volumes = ["nostr-relay-data:/var/lib/nostr-relay"]
reason = "nostr-rs-relay SQLite journal and WAL require a writable durable path"
```

Validator rules:

| Code | Condition |
|------|-----------|
| **E026** | `enabled=true` requires `sovereign_mesh.enabled` or `sovereign_mesh.solid_pod`. |
| **E027** | `implementation="external"` requires `federation.mode="client"` + `external_url`. |
| **E028** | `port` must not collide with RESERVED_PORTS or other services. |
| **E029** | `bind="0.0.0.0"` with `expose=false` is a wiring error. |
| **W030** | `ingress_policy="open"` — warning; relay accepts writes from anyone. |
| **E031** | `allow_nip04=true` — legacy DMs leak metadata; prefer NIP-17. |
| **W021** | Feature enabled without `[security.exceptions.nostr-relay]` writable-volumes block. |

## Event kinds accepted by default

| Kind | NIP | Purpose |
|------|-----|---------|
| 1 | NIP-01 | General notes (useful for public announcements) |
| 1059 | NIP-17 | Sealed gift-wrap DMs — the recommended inbound channel |
| 27235 | NIP-98 | HTTP auth (read-only; bridge handles these out-of-band) |
| 30078 | NIP-33/78 | Parameterised replaceable agent state |
| 38000-38099 | reserved | Agent-intent (inbound request for an agent to act) |
| 38100-38199 | reserved | Agent-response (reply to an agent-intent) |

Kind `4` (legacy unencrypted DMs) is rejected by default. Set
`allow_nip04 = true` to accept them; the validator will emit E031 so
you know the decision was deliberate.

## Observability

```sh
# Relay state surfaced through the management-api
curl -s http://localhost:9090/health/relay | jq

# Prometheus metrics
curl -s http://localhost:9091/metrics | grep '^agentbox_relay_'
```

Key metrics:

- `agentbox_relay_connections_active{state}` — current clients
- `agentbox_relay_events_total{direction,kind,outcome}` — event counters
- `agentbox_relay_auth_fail_total{reason}` — rejected AUTH attempts
- `agentbox_pod_write_total{direction,outcome}` — inbox/outbox persistence
- `agentbox_relay_db_bytes` — SQLite on-disk size
- `agentbox_relay_retention_pruned_total` — NIP-40 / TTL sweep results

## Common gotchas

- **"Cannot connect" from outside Docker.** Did you set `expose = true`?
  Without `expose`, the port is bound on the container but not published
  on the host. Check `docker compose ps` — the port mapping is explicit.
- **Every event arrives twice.** You're reading both the embedded relay
  and a public relay in `NOSTR_RELAYS`, and the external world mirrored
  your outbound event back. Either filter on `pubkey` (exclude your own)
  or set `external_fanout = "publish-only"`.
- **Inbox is growing.** `retention_days` does not delete events with
  a NIP-40 `expiration` tag in the future. Set the tag explicitly on
  events you want pruned sooner, or lower `retention_days`.
- **`W021` on startup.** You enabled the relay but forgot to add
  `[security.exceptions.nostr-relay]`. Uncomment the block in
  `agentbox.toml` and rebuild.
- **Bridge up, relay down.** The relay can crash (OOM, corrupt DB) and
  supervisord restarts it. While it's down, outbox publishes queue with
  `status = "pending"` and retry on restart. Nothing is lost.

## Disabling it

```toml
[sovereign_mesh.relay]
enabled = false
```

Rebuild. The supervisor block vanishes, the Nix-packaged relay is not
added to the image, the bridge falls back to its pre-ADR-009 behaviour
(public relays only). Existing pod mailbox entries stay on disk.

## Further reading

- [PRD-004 — External agent messaging](../reference/prd/PRD-004-external-agent-messaging.md)
- [ADR-009 — Embedded Nostr relay and pod-inbox bridge](../reference/adr/ADR-009-embedded-nostr-relay.md)
- [DDD-003 — Sovereign messaging domain](../reference/ddd/DDD-003-sovereign-messaging-domain.md)
- [Developer: sovereign mesh internals](../developer/sovereign-mesh.md)
- [nostr-rs-relay upstream](https://sr.ht/~gheartsfield/nostr-rs-relay/)
- [NIP-42 relay AUTH](https://github.com/nostr-protocol/nips/blob/master/42.md)
- [NIP-17 sealed DMs](https://github.com/nostr-protocol/nips/blob/master/17.md)
