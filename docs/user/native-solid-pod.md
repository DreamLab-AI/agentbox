# Native Solid pod — Docker sidecar + Cloudflare Tunnel

This page covers running `solid-pod-rs-server --features git` as a **Docker
sidecar** alongside the agentbox stack and routing public traffic to it via a
[Cloudflare Zero Trust Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

For the in-container (supervisord) deployment see [solid-pod.md](solid-pod.md).

## Overview

```
Internet
  │  HTTPS pods-native.dreamlab-ai.com
  ▼
Cloudflare Edge ──► cloudflared-pod (tunnel client)
                          │  http://solid-pod-server:8410
                          ▼
                   solid-pod-server (pod-internal network)
                          │  /var/lib/solid/pods
                          ▼
                   agentbox-solid-data (named Docker volume)
```

`cloudflared-pod` and `solid-pod-server` share a Docker-internal bridge
(`pod-internal`, `internal: true`). No pod port is published to the host.
`solid-pod-server` also joins `visionclaw_network` so the agentbox management
API can reach it at `http://solid-pod-server:8410`.

## Prerequisites

- Docker 25+ with Compose v2 plugin
- `agentbox-solid-data` volume exists (created by the agentbox stack)
- `visionclaw_network` external network exists (created by the agentbox stack)
- `solid-pod-rs` source at `../solid-pod-rs` relative to `agentbox/` (i.e.
  `/home/devuser/workspace/solid-pod-rs` inside the mad-workspace volume)
- A Cloudflare Zero Trust tunnel configured to route
  `pods-native.dreamlab-ai.com` → `http://solid-pod-server:8410`

## Step 1 — Create the Cloudflare Tunnel

1. Log in to the [Cloudflare Zero Trust dashboard](https://one.cloudflare.com).
2. Go to **Networks → Tunnels → Create a tunnel**.
3. Select **Cloudflared** as the connector type.
4. Name the tunnel (e.g. `agentbox-solid-pods`).
5. Copy the **tunnel token** — you'll need it in Step 2.
6. Add a **Public Hostname** route:
   - Subdomain: `pods-native`
   - Domain: `dreamlab-ai.com`
   - Service: `http://solid-pod-server:8410`
7. Save. The tunnel stays in a "degraded" state until `cloudflared-pod` connects.

## Step 2 — Configure env vars

```sh
cp agentbox/.env.solid-pods.example agentbox/.env.solid-pods
# Edit .env.solid-pods and fill in:
#   CLOUDFLARE_TUNNEL_TOKEN  — token from Step 1
#   SOLID_ADMIN_KEY          — openssl rand -hex 32
#   SOLID_ALLOWED_ORIGINS    — comma-separated CORS origins
#   SOLID_POD_PUBLIC_URL     — https://pods-native.dreamlab-ai.com
```

`SOLID_ADMIN_KEY` must match the `NATIVE_POD_ADMIN_KEY` secret set in the
Cloudflare auth-worker (`wrangler secret put NATIVE_POD_ADMIN_KEY`).

## Step 3 — Build and start

```sh
# From workspace root (where docker-compose.yml lives):
docker compose \
  -f agentbox/docker-compose.yml \
  -f agentbox/docker-compose.override.yml \
  -f agentbox/docker-compose.solid-pods.yml \
  --env-file agentbox/.env.solid-pods \
  up -d solid-pod-server cloudflared-pod
```

The first run builds `solid-pod-rs-server` from source (~5–10 min on first
build; subsequent builds use the Cargo layer cache).

## Step 4 — Verify

```sh
# Health check (container-internal)
docker exec solid-pod-server curl -sf http://localhost:8410/.well-known/solid

# Public endpoint (via Cloudflare Tunnel — wait ~30 s for tunnel to connect)
curl -s https://pods-native.dreamlab-ai.com/.well-known/solid | jq

# Tunnel status
docker logs cloudflared-pod --tail 20
```

## In-container alternative (supervisord)

If you prefer to run the server inside the agentbox container rather than as a
sidecar, copy the binary and include the supervisord fragment:

```sh
# Build the binary with git feature
cargo build --release --features git -p solid-pod-rs-server \
  --manifest-path /home/devuser/workspace/solid-pod-rs/Cargo.toml

# Copy into agentbox
docker cp target/release/solid-pod-rs-server agentbox:/usr/local/bin/

# Include the supervisord fragment (already present at config/supervisord.solid-pod.conf)
docker exec agentbox supervisorctl reread
docker exec agentbox supervisorctl update
docker exec agentbox supervisorctl start solid-pod-server
```

The fragment is at `agentbox/config/supervisord.solid-pod.conf`. It is set to
`autostart=false` so it will not start automatically — enable it explicitly.

## Files added by this sprint

| File | Purpose |
|------|---------|
| `agentbox/Dockerfile.solid-pod` | Multi-stage Rust build (`--features git`), minimal bookworm-slim runtime |
| `agentbox/docker-compose.solid-pods.yml` | Compose overlay: `solid-pod-server` + `cloudflared-pod` |
| `agentbox/.env.solid-pods.example` | Env var reference — copy and fill before running |
| `agentbox/config/supervisord.solid-pod.conf` | Optional in-container supervisord fragment |

## Further reading

- [solid-pod.md](solid-pod.md) — in-container deployment and full feature reference
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [solid-pod-rs upstream](https://github.com/DreamLab-AI/solid-pod-rs)
