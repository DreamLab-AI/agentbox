# Troubleshooting

Common failure modes and what to do about them.

## Why this page exists

Agentbox has multiple moving parts — a Nix-built image, a supervisor running 8-20 programs, five pluggable adapters, optional GPU passthrough, and a few HTTP endpoints. When something is wrong the signal you see (`/ready` never goes green, `docker compose up` hangs) is almost never the cause. This page lists the failure modes we actually see, in the order they are worth checking, with the one or two commands that isolate each one. Design context: [ADR-006](../reference/adr/ADR-006-immutable-runtime-bootstrap.md) (bootstrap contract) and [ADR-007](../reference/adr/ADR-007-runtime-contract-and-container-hardening.md) (probe and image contract).

When in doubt:

```sh
./agentbox.sh health --json         # per-service status
docker logs agentbox --tail 200
docker exec agentbox supervisorctl status
```

---

## `agentbox.sh up` hangs on `/ready` poll

Boot succeeded (container started) but readiness check never passed. Usually one of:

1. **Adapter failed to connect.** Check:
   ```sh
   curl http://localhost:9090/health | jq .adapters
   ```
   Any slot reporting `degraded` or `failed` is the culprit. Inspect its logs:
   ```sh
   docker exec agentbox supervisorctl tail -f <adapter-service>
   ```

2. **Bootstrap sentinel never written.** The `[program:bootstrap-seal]` writes `/run/agentbox/bootstrap.done` after all required programs reach RUNNING.
   ```sh
   docker exec agentbox supervisorctl status | grep -v RUNNING
   ```
   Every required program must be RUNNING. A STARTING, FATAL, or EXITED program blocks the sentinel and thus `/ready`.

3. **Required mount missing.** `/ready` checks `/workspace`, `/var/lib/ruvector`, `/var/lib/solid` exist.
   ```sh
   docker inspect agentbox --format '{{json .Mounts}}' | jq
   ```

## External agent can't reach the embedded Nostr relay

Walk the chain from outside in:

```sh
# 1. Manifest: expose must be true and bind must be 0.0.0.0
grep -A4 '^\[sovereign_mesh.relay\]' agentbox.toml

# 2. Compose publishes the port
docker compose ps | grep 7777

# 3. Relay is actually up inside the container
docker exec agentbox supervisorctl status nostr-relay

# 4. NIP-11 info doc responds
curl -H 'Accept: application/nostr+json' http://<host>:7777/ | jq

# 5. NIP-42 AUTH: your client finished the challenge
docker exec agentbox tail -20 /var/log/nostr-relay.log | grep -i auth
```

If `/health/relay` returns `outbox_pending > 0` and stays there, the
bridge's fan-out list cannot reach any external relay. Check
`NOSTR_RELAYS` and the container's DNS.

If inbound events never appear in `pods/<npub>/events/inbox/`:

1. Is `pod_bridge = true`?
2. Does the event have a `p` tag matching your container's npub?
3. Is the event kind in `allowed_kinds`?
4. Is the signing pubkey in `allowed_pubkeys` (or is policy `signed-only`)?

## Privacy filter `/health` reports `unavailable`

The sidecar loaded but something in the model-load path failed. Usually one of:

1. **HuggingFace weights not cached.** First boot pulls ~3 GB into
   `/workspace/.cache/huggingface`. If the container was rebuilt with a
   fresh workspace volume, the cache is empty. Give it a few minutes:
   ```sh
   docker exec agentbox tail -f /var/log/opf-router.log
   ```
   Look for `model_loaded`. If you see `model_load_failed` the error
   type is attached.

2. **`mode="local-gpu"` but no CUDA in-container.** `gpu.backend=ollama-cuda`
   puts CUDA in the ollama sidecar, not in agentbox. For the privacy-filter
   sidecar to hit the GPU you need `gpu.backend=local-cuda`. Flip it,
   rebuild, or drop to `mode="local-cpu"`.

3. **Under-provisioned CPU host.** `local-cpu` with < 6 GB free RAM will
   OOM during load. Run `free -h` and check MemAvailable. If you're below
   the floor, either add RAM or set `enabled=false`.

All three produce strict-mode 503s at adapter write time and
`opf_fail_closed_total` increments. Soft-mode slots keep working (at the
cost of unredacted writes) — look at `opf_fail_open_total` to see how
many passed through.

## `/metrics` port not reachable

Walk the five-link chain (manifest → flake env → compose → container → host):

```sh
grep -A2 '^\[observability\]' agentbox.toml        # 1. manifest
docker exec agentbox env | grep AGENTBOX_METRICS    # 2. container env
docker compose config | grep -A3 ports:             # 3. compose
docker exec agentbox ss -tlnp | grep :9091          # 4. bound inside
curl -sf http://localhost:9091/metrics | head -5    # 5. reachable on host
```

First step that fails is where to fix.

## `nix build .#runtime` fails with a hash mismatch

The shipped tree carries resolved hashes for every npm service and the
solid-pod-rs source — fresh clones build without manual prefetch. You
hit this only after one of:

- A `package-lock.json` change in any of `management-api/`, `mcp/`,
  `skills/openai-codex/mcp-server/`, `skills/lazy-fetch/mcp-server/`,
  `skills/playwright/mcp-server/`, `skills/comfyui/mcp-server/`.
- A `solid-pod-rs` rev bump in `lib/solid-pod-rs.nix`.
- Adding a new `makeNpmCli` entry in `flake.nix` with `lib.fakeHash`.

The error format is always the same:

- A Nix `hash mismatch` line: `expected: sha256-AAAAAAA…=` (placeholder)
  and `got: sha256-<real>=` (the value you need).
- A `preFetch` hook hint pointing at the resolver command.

The fastest path is the prefetch helper:

```sh
# One pass — walks every fakeHash and patches it in. Idempotent.
./scripts/prefetch-hashes.sh

# Single target:
./scripts/prefetch-hashes.sh --service management-api
./scripts/prefetch-hashes.sh --service solid-pod-rs

# Preview without writing:
./scripts/prefetch-hashes.sh --dry-run
```

Manual fallback if you don't have the helper available:

```sh
# Local npm services (buildNpmPackage)
nix run nixpkgs#prefetch-npm-deps -- management-api/package-lock.json

# solid-pod-rs source (fetchFromGitHub)
nix-prefetch-url --unpack \
  https://github.com/DreamLab-AI/solid-pod-rs/archive/<rev>.tar.gz
nix hash convert --hash-algo sha256 --to sri <base32-output>

# Global npm CLIs (tarball fetch)
nix-prefetch-url https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz
nix hash convert --hash-algo sha256 --to sri <base32-output>
```

Paste the returned hash into `lib/npm-services.nix` or `flake.nix`, rebuild. See [developer/version-tracking.md](../developer/version-tracking.md) for the full workflow and [developer/testing.md](../developer/testing.md#prefetching-hashes) for the helper docs.

## `docker load < result` says "invalid tar header"

`nix build .#runtime` produces a [nix2container](https://github.com/nlewo/nix2container) OCI manifest JSON at `./result`, not a `docker save` tarball — so `docker load` can't consume it directly. Use the helper the flake exposes:

```sh
nix run .#runtime.copyToDockerDaemon
```

That uses skopeo to talk to the local Docker socket and load the image with its content-addressed tag (`agentbox:runtime-x86_64-linux` or `…-aarch64-linux`). `agentbox.sh up --build` and `scripts/start-agentbox.sh` use the same path internally.

## GPU not detected

1. Host sees GPU:
   ```sh
   nvidia-smi      # or rocm-smi
   ```
2. Container runtime supports it:
   ```sh
   docker run --rm --gpus all nvidia/cuda:13.1.0-base-ubuntu24.04 nvidia-smi
   ```
3. Manifest is right:
   ```toml
   [gpu]
   backend = "ollama-cuda"
   ```
4. Compose was regenerated:
   ```sh
   ./agentbox.sh rebuild
   ```

`[gpu].backend = "local-cuda"` also requires `[toolchains].cuda = true` (validator rule E019).

## macOS: `/metrics` unreachable despite correct config

Docker Desktop on macOS runs the container in a Linux VM; the port must forward from VM to Mac. Docker Desktop normally handles this automatically — if not, check Settings → Resources → Proxies. **OrbStack has better defaults here.**

Metal GPU is never accessible — see [platforms.md](platforms.md) for the remote-GPU workaround.

## Windows: container won't start in WSL2

1. **WSL2 integration enabled in Docker Desktop** (Settings → Resources → WSL Integration).
2. **Run commands from the WSL2 shell**, not PowerShell.
3. **Clone the repo inside the WSL2 filesystem** (`/home/<user>/agentbox`), not `/mnt/c/...` — volume mounts on `/mnt/c` are orders of magnitude slower.

## `docker compose up` picks the wrong image

See what compose resolved:

```sh
docker compose config | grep image:
```

- Wants registry instead of local build:
  ```sh
  export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
  ./agentbox.sh up --registry
  ```
- Wants local build instead of registry:
  ```sh
  unset AGENTBOX_IMAGE_REF
  ./agentbox.sh up --build
  ```

## Validator rejects manifest with `E###`

Every error code has a specific cause. Look up the rule in [ADR-005 §Validation](../reference/adr/ADR-005-pluggable-adapter-architecture.md) or [ADR-007 §4a](../reference/adr/ADR-007-runtime-contract-and-container-hardening.md).

Common ones:

| Code | Meaning |
|---|---|
| E001 | `adapters.*="external"` without `federation.mode="client"` |
| E006 | `gaussian_splatting=true` without `gpu.backend="local-cuda"` |
| E007 | Both `comfyui_builtin` and `comfyui_external` enabled |
| E017 | Enabled provider's env var missing |
| E019 | `toolchains.cuda=true` without `gpu.backend="local-cuda"` |
| E020 | `[security.exceptions.<name>]` block declared but feature disabled |
| E021 | Feature enabled without its usual security exception block (renamed from W021) |
| E016 | Unknown manifest key — usually a typo, or a removed enum value (e.g. `pods = "local-jss"` post-2026-04-25) |
| W012 | `federation.mode="client"` with `local-*` adapters (graceful-degrade testing — advisory) |
| W030 | `relay.ingress_policy="open"` (advisory — prefer allowlist or signed-only) |
| W031 | `relay.allow_nip04=true` (advisory — prefer NIP-17 sealed gift-wrap) |
| W038 | `consultants.intelligence_signal=true` without writable target dir (degraded, not blocking) |
| W039 | `relay.ingress_policy="allowlist"` with empty `allowed_pubkeys` |
| W040 | Provider has `auth_mode="oauth"` but no in-container OAuth CLI |
| W041 | `privacy_filter.enabled=false` but policy slots declare non-default values (dead config) |

## Backup / restore round-trip fails

```sh
./agentbox.sh backup                              # ./backups/agentbox-backup-<ts>.tgz
./agentbox.sh down
./agentbox.sh restore ./backups/agentbox-backup-<ts>.tgz
```

If restore fails with missing manifest:

```sh
tar tzf ./backups/agentbox-backup-<ts>.tgz | grep MANIFEST.json
```

Secrets are excluded by default; add `--include-secrets` if you need them in the archive.

## Clean slate

```sh
./agentbox.sh down --volumes    # destructive — confirms before running
docker image rm ghcr.io/dreamlab-ai/agentbox:latest 2>/dev/null
docker image rm agentbox:runtime-x86_64-linux 2>/dev/null
rm -rf ./backups ./workspace
docker pull ghcr.io/dreamlab-ai/agentbox:latest
./agentbox.sh up
```

## Still stuck?

Open an issue at https://github.com/DreamLab-AI/agentbox/issues with:

- `./agentbox.sh health --json` output
- The `agentbox.toml` you're running (redact `env_var` values)
- `docker logs agentbox --tail 100`
- Host OS + Docker version

Do **not** include your `.env` contents.
