# Troubleshooting

Common failure modes and what to do about them. When in doubt:

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

Six `npmDepsHash` values in `lib/npm-services.nix` (and any still-placeholder CLI `sha256` in `lib/npm-cli.nix`) must be resolved the first time you build. **This only affects realisation**: `nix flake check`, `nix eval`, `nix build .#compose`, and CI lint all work on a fresh clone.

When you run `nix build .#runtime` against an unresolved placeholder you'll see two things in the build output:

- A Nix `hash mismatch` line listing `expected: sha256-AAAAAAA…=` and `got: sha256-<real>=`.
- A `preFetch` operator hint pointing at the resolver command for the specific service or CLI.

For each failing derivation, run the command the hint prints. Canonical forms:

```sh
# Local npm services (buildNpmPackage) — one per service
nix run nixpkgs#prefetch-npm-deps -- management-api/package-lock.json
nix run nixpkgs#prefetch-npm-deps -- mcp/package-lock.json
# ...per service

# Global npm CLIs (tarball fetch)
nix-prefetch-url https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz
nix hash to-sri --type sha256 <base32-output>
```

Paste the returned hash into `lib/npm-services.nix` or `flake.nix`, rebuild. See [developer/version-tracking.md](../developer/version-tracking.md) for the full workflow.

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
| W021 | Feature enabled without its usual security exception block (warning) |

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
