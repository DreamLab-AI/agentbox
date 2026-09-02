# HP-Desktop peer node

A second agentbox runs on HP-Desktop (`john@10.10.10.1`, reachable from machinelearn only over the
25 G rail `10.10.10.0/30`). It is a full agentbox with its own `did:nostr` identity, not an annexe:
the dream-engine annexe (ADR-052) is a bare SSH working directory on the same host and stays
separate. First brought up 2026-09-02; this page records the layout, the manifest deltas, and what
the mesh does and does not do between the two nodes today.

## Layout on the HP

| Item | Value |
|---|---|
| Checkout | `~/githubs/visionflow-hp/agentbox` (agentbox `main`, same commit as the ml node) |
| Compose project | `agentbox` (directory name), so the June-2026 named volumes re-attach: `agentbox-sovereign-identities`, `agentbox-solid-data`, `agentbox-nostr-relay-data`, `agentbox-secrets`, ... |
| Postgres volume | `ruvector_postgres_data_hp` (fresh). The stale June `ruvector_postgres_data_v2` is left untouched |
| Image | `agentbox:runtime-x86_64-linux`, streamed from the ml daemon: `docker save agentbox:runtime-x86_64-linux \| ssh john docker load` (41.8 GB, roughly 25 MB/s, under half an hour). No Nix build on the HP |
| Bring-up | `docker compose -f docker-compose.yml -f docker-compose.hp.yml up -d` |
| Identity | `agentbox-core` minted at first boot. The June volume held a clone of the ml identity (same npub); it is parked as `agentbox-core.json.ml-clone-2026-08-02` inside the identities volume |
| Env | `.env` carries `RUVECTOR_PG_PASSWORD` only. No API keys are copied to the HP |

`docker-compose.override.yml` must not be used on the HP. It is machinelearn-specific: the MAD
workspace volume, the Dell NFS store at `/mnt/dell`, five `PROJECT_DIR_*` binds, the Docker
socket, a 30-CPU limit. `docker-compose.hp.yml` is the self-contained replacement (env file,
RuVector env, GPU reservation, `~/.claude` binds, the fresh Postgres volume name).

## Manifest deltas (`agentbox.toml` on the HP)

Start from the ml manifest and change:

| Section | Change | Why |
|---|---|---|
| `[dream_machine]` | `enabled = false` | One control plane only; the ml node dreams |
| `[networking]` | `tailscale = false`, `hostname = "agentbox-hp"`, and delete `[security.exceptions.tailscale]` | No auth key on the HP; the validator (E020) rejects an exception block for a disabled gate |
| `[mesh]` | `mode = "client"` | The schema accepts only `standalone` or `client`; `federated` is documented in comments but fails validation (E016) |
| `[sovereign_mesh.relay]` | `bind = "0.0.0.0"`, `expose = true`, ml node key added to `allowed_pubkeys` | Inert until a Nix rebuild: bind and allowlist are baked into the supervisor environment (`flake.nix`, `[program:nostr-relay]`) |
| `[interaction_plane.proxy]` | both node keys in `allowed_pubkeys` | Boot class: projected to `workspace/.agentbox/nip98-proxy-config.json` at every start |

Validate before copying: `node scripts/agentbox-config-validate.js agentbox.toml` must print no `E` codes.

## What the mesh does between the nodes today

Probed on 2026-09-02 with a small nostr-tools script (kind-1 publish plus NIP-98 GET).

| Probe | Direction | Result |
|---|---|---|
| `:9096` NIP-98 door, unsigned | ml to HP | 401 |
| `:9096` NIP-98 door, signed by the ml node key | ml to HP | 200, `X-Agentbox-Pubkey` stamped |
| `:9096` NIP-98 door, signed by the HP node key | HP to ml | 401 `pubkey_not_allowed` until the HP key was added to the ml proxy allowlist, then 200 |
| Embedded relay `:7777`, allowlisted signer | ml to HP | `OK true`, event stored and readable back |
| Embedded relay `:7777`, ml node key (not in the baked allowlist) | ml to HP | relay `OK true`, `nostr-pod-bridge` logs `rejected pubkey=...` and drops it |

So the identity-gated HTTP door federates today with a manifest edit and a proxy restart on each
side. The relay path does not: the pod-bridge allowlist is baked, the relay listens on container
loopback, and `AGENTBOX_RELAY_FANOUT` is baked `off` on the current image although the manifest
says `bidirectional`. The `[mesh]` keys `peer_relays`, `federated_kinds`, `allowed_remote_dids`
and `subscribed_kinds` have no code consumer. Cross-node relay federation (PRD-010 Phase 3,
ADR-073) is code work, not a config flip.

To reach the HP relay from the ml side for testing, run a tap inside the HP container and tunnel
to it, because the bridge binds `127.0.0.1` inside the container:

```bash
# on the HP
docker exec -d agentbox socat TCP-LISTEN:17777,fork,reuseaddr TCP:127.0.0.1:7777
# on the ml side (container IP from docker inspect)
ssh -f -N -L 17777:<hp-container-ip>:17777 john
```

Kill the tap afterwards; it exposes the relay on the HP docker bridge.

## Admitting the HP node on the ml side

Add the HP `agentbox-core` x-only pubkey to `[interaction_plane.proxy].allowed_pubkeys` in the ml
manifest (boot class). For an immediate effect without a restart, add it to
`workspace/.agentbox/nip98-proxy-config.json` and `supervisorctl restart nip98-proxy`; the
manifest edit keeps it across boots.

## Notes

* The HP GPUs are close to full with the Loom model container. The agentbox has passthrough but
  little free VRAM.
* `docker cp` into the container fails (`read_only` rootfs). Use
  `docker exec -i agentbox sh -c 'cat > /tmp/file' < file`; `/tmp` is a tmpfs.
* The HP node does not mount the estate checkout, so `workspace/project` is empty there. Tools
  that expect it (the dream engine, project tracking) are disabled by the manifest deltas above.
