# Mesh Deployment Guide

Agentbox can participate in a cross-substrate mesh federation via its embedded Nostr relay. Three modes are available:

## Modes

### Standalone (default)

No federation. The embedded relay on `:7777` is bound to `127.0.0.1` and only accepts connections from the local management-api.

### Federated

The relay is exposed externally. Peer substrates (VisionClaw, forum workers, other agentboxes) can connect and exchange events.

**To enable:**

1. In `agentbox.toml`:
   ```toml
   [mesh]
   mode = "federated"
   peer_relays = ["wss://forum.example.com/relay"]
   federated_kinds = [1, 1059, 30050, 30910, 31400, 31401, 31402, 31403, 31404, 31405]
   allowed_remote_dids = ["did:nostr:<peer-hex-pubkey>"]

   [sovereign_mesh.relay]
   bind = "0.0.0.0"
   expose = true
   ```

2. In `docker-compose.yml`, expose port 7777:
   ```yaml
   ports:
     - "7777:7777"
   ```

   When using the Nix-generated compose (`nix build .#compose`), the port is
   automatically included when `[sovereign_mesh.relay].expose = true`.

3. Configure TLS termination via the https-bridge (priority-32 supervisord block) or an external reverse proxy.

### Client

Subscribes to peer relays but does not expose its own relay externally. Useful for read-only mesh participation.

## Security Considerations

- All inbound events are signature-verified before disk write
- `ingress_policy = "allowlist"` restricts to known pubkeys
- `allowed_remote_dids` limits which peers can connect
- `federated_kinds` restricts which event types cross the boundary
- NIP-42 AUTH gate on the embedded relay authenticates connecting clients
- The pod-bridge relay consumer enforces DDD-003 invariants I01, I07, I08, I10

## RelayConsumer (F16)

The `RelayConsumer` class bridges the embedded relay and the Solid pod inbox.
It is started automatically by the management-api when both env vars are true:

- `AGENTBOX_RELAY_ENABLED=true`
- `AGENTBOX_RELAY_POD_BRIDGE=true`

These are set by `flake.nix` from the `[sovereign_mesh.relay]` section in
`agentbox.toml`. The consumer requires `AGENTBOX_NPUB` (set by
`sovereign-bootstrap.py`) to know which local identities to accept events for.

### Runtime flow

**Inbound:** relay subscription -> signature verify -> ingress policy -> recipient match -> atomic pod write -> events adapter dispatch -> intent queue (for agent-intent kinds 38000-38099).

**Outbound:** poll `pods/<npub>/events/outbox/` -> sign -> publish to relay (+ external fanout if configured) -> rename with status=published.
