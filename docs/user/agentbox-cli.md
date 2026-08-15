# agentbox.sh CLI Reference

`agentbox.sh` is the operator entrypoint for managing the Docker stack locally and
connecting to remote OCI instances. Run `./agentbox.sh --help` for inline usage.

## Remote operator commands

These commands connect to a remote instance over SSH. Set `AGENTBOX_IP` or use `-i
<ip>` to specify the target.

| Subcommand | Description |
|---|---|
| `ssh` | Open an interactive SSH session on the remote instance |
| `vnc` | Open an SSH tunnel to the VNC desktop (forwards `localhost:5901`) |
| `browser` | Open SSH tunnels for VNC + Chrome DevTools (ports 5901 and 9222) |
| `code` | Open an SSH tunnel to code-server (forwards `localhost:8080`) |
| `api` | Open an SSH tunnel to the Management API (forwards `localhost:9090`) |
| `all` | Open all tunnels at once (VNC, code-server, Management API, CDP) |
| `status` | Show uptime, memory, disk, and running containers on the remote instance |
| `ip` | Print the configured instance IP |
| `provision` | Provision a new instance. `--target oci\|fly\|hetzner\|bare` (default: `oci`) |
| `setup` | Run the initial host setup script on the remote instance (Docker, VNC, browser tools) |
| `start-browser` | Start a visible Chromium browser on the remote with CDP on port 9222 |
| `backup` | Backup named volumes and config to a timestamped tarball. `--out <path>` `--include-secrets` |
| `restore` | Restore volumes and config from a tarball. `./agentbox.sh restore <file> [--force]` |

## Local lifecycle commands

These commands operate on the local Docker stack.

| Subcommand | Description |
|---|---|
| `up` | Start the Docker stack. `--build`: Nix build + docker load first. `--registry`: use `AGENTBOX_IMAGE_REF` from env |
| `down` | Stop the Docker stack. `--volumes`: also remove named volumes (confirms before deleting) |
| `build` | Build the Nix image without starting it. `--variant runtime\|desktop\|full` (default: `runtime`) |
| `rebuild` | Full dev-loop cycle: `down` + `build` + `up --build` + cleanup |
| `update` | Update flake inputs and npm CLI versions. `--check` (report only), `--flake-only`, `--npm-only` |
| `logs` | Follow logs. No argument: compose logs. With service name: `supervisorctl tail -f <service>` |
| `shell` | Open a shell in the running container. With profile name: opens fish in that profile directory |
| `health` | Show service health from `/health`. `--json`: raw JSON output |
| `browsercontainer` | Manage the GPU browser sidecar. Sub-commands: `up`, `down`, `logs`, `health`, `status`, `rebuild`, `shell`, `gpu`, `cdp` |
| `voice` | Manage and open the HTTPS operator cockpit. Sub-commands: `open`, `up`, `down`, `logs`, `health`, `status`, `certs`, `rebuild`, `shell` |
| `ruvector` | Manage the ruvector-postgres memory sidecar lifecycle and data-hygiene ops (see below) |
| `migrate-workspace` | One-shot rsync from the legacy `multi-agent-docker_workspace` volume into `agentbox-workspace`, then patches the override file |
| `preflight` | Validate the local environment and manifest before `up`: compose merge, Nix flake eval (W021 audit gate), host bind targets, external volumes |

## `ruvector` — memory sidecar lifecycle

Gated, snapshot-rehearsed lifecycle management for the ruvector-postgres
memory backend, implemented in `scripts/ruvector-sidecar-update.sh`
(PRD-018 / ADR-036 D2). The image pin lives in
`[integrations.ruvector_external]`; every mutating op rehearses against a
`pg_basebackup` snapshot before touching the production dataset, and records
enough state for `rollback` to undo the last change.

| Subcommand | What it does | Applies when |
|---|---|---|
| `status` | Show pinned image, running image, sidecar health | always |
| `check` | Compare pinned vs. running image/digest | always |
| `test` | Run the smoke suite (write → ANN search → rollback round trip) | always |
| `update` | Rehearse a new pinned image against a snapshot, swap if the rehearsal passes, auto-rollback on any post-swap failure | `--to <ref>`, `--dry-run`, `--yes`, `--adopt`, `--keep-candidate` |
| `rollback` | Revert the pin and restore the sidecar from the last recorded snapshot | always |
| `migrate-trajectories` | Additive schema for the learning loop (trajectories/trajectory_steps tables) | dry-run by default; `--yes` applies (no manifest flag — additive/idempotent) |
| `repair-namespaces` | Un-swap namespace↔value rows corrupted by a past bug | dry-run by default; `--yes` **and** `[memory_hygiene].allow_namespace_repair = true` to apply |
| `backfill-embeddings` | Compute embeddings for NULL-embedding rows via Xinference `bge-small-en-v1.5` | dry-run by default; `--yes` **and** `[memory_hygiene].allow_embedding_backfill = true` |
| `archive-legacy` | Snapshot, `COPY`-out, then delete frozen legacy/dead-hooks namespaces | dry-run by default; `--yes` **and** `[memory_hygiene].allow_legacy_archival = true` |
| `aggregate-effectiveness` | Distil `trajectory_steps` into Wilson lower-bound + recency-decay effectiveness aggregates | dry-run by default; `--yes` **and** `[memory_learning].enabled = true` |
| `build-metadata-gin` | Build the GIN index on `metadata` jsonb (`jsonb_path_ops`) for tag `@>` retrieval | dry-run by default; `--yes` **and** `[integrations.ruvector_external].metadata_gin = true` |

Every destructive op is dry-run unless BOTH conditions hold: you pass
`--yes`, and the matching manifest flag is `true`. This is a fail-closed
contract — an absent block or a `false` flag refuses to mutate, regardless
of `--yes`.

```sh
./agentbox.sh ruvector status                    # pinned vs. running image
./agentbox.sh ruvector rollback                   # revert the last sidecar update from its snapshot
./agentbox.sh ruvector migrate-trajectories       # additive learning-loop schema (dry-run; --yes applies)
./agentbox.sh ruvector repair-namespaces          # dry-run un-swap of corrupted namespace<->value rows
./agentbox.sh ruvector backfill-embeddings        # dry-run NULL-embedding backfill via Xinference
./agentbox.sh ruvector archive-legacy             # dry-run archive+delete of frozen legacy rows
./agentbox.sh ruvector aggregate-effectiveness    # dry-run Wilson+recency effectiveness aggregates
./agentbox.sh ruvector build-metadata-gin         # dry-run GIN on metadata jsonb_path_ops for tag @>
```

**Status as of 2026-07-05**: all five hygiene/aggregation ops
(`repair-namespaces`, `backfill-embeddings`, `archive-legacy`,
`aggregate-effectiveness`, `build-metadata-gin`) have already been run once
against the production store — 178,238 rows un-swapped, 36 embeddings
backfilled (0 NULL remain), 2,014,173 legacy rows archived to a cold archive
and deleted, and the metadata GIN index built. The corresponding
`[memory_hygiene]` flags were reset to `false` afterwards (fail-closed by
default) — running any of these ops again requires re-enabling its flag
first. Recovery archives from that run are kept under
`backups/ruvector-sidecar/`.

## Global options

| Option | Description |
|---|---|
| `-i <ip>`, `--ip <ip>` | Override the remote instance IP for this invocation |
| `-h`, `--help` | Show usage |

## Examples

```bash
./agentbox.sh up                        # Start stack, wait for /ready
./agentbox.sh up --build                # Nix build + load, then start
./agentbox.sh up --registry             # Use AGENTBOX_IMAGE_REF from env
./agentbox.sh down --volumes            # Stop and remove volumes (destructive)
./agentbox.sh build --variant full      # Build full image (no load)
./agentbox.sh rebuild                   # Full dev-loop iteration
./agentbox.sh preflight                 # Check env before starting
./agentbox.sh logs management-api       # Follow a single service
./agentbox.sh shell                     # tmux session in container
./agentbox.sh shell claude              # fish in the claude profile
./agentbox.sh health --json             # Raw JSON health response
./agentbox.sh provision --target bare --host ubuntu@192.168.1.10
./agentbox.sh backup --include-secrets  # Backup including sovereign identities
./agentbox.sh restore ./backups/agentbox-backup-20260101T000000Z.tgz
./agentbox.sh browsercontainer up       # Start GPU browser sidecar
./agentbox.sh browsercontainer cdp      # Check CDP connectivity
./agentbox.sh ruvector status           # Memory sidecar: pinned vs. running image
./agentbox.sh ruvector build-metadata-gin --yes  # Apply (requires metadata_gin = true)
```

## Notes

- `preflight` is the canonical pre-start validation command. It checks compose merge
  cleanness, Nix flake evaluation (W021 audit gate), host bind-mount paths, and
  external volume existence.
- `build` does not load the image into Docker. Use `up --build` or manually run
  `nix run .#runtime.copyToDockerDaemon` after `build`.
- `migrate-workspace` is idempotent. If the target volume already has content, rsync
  syncs only deltas.
- The `browsercontainer` subcommand operates on the separate
  `docker-compose.browsercontainer.yml` compose file, not the main stack.
- The `ruvector` subcommand operates on the main stack's `ruvector-postgres`
  service and reads/writes `[integrations.ruvector_external]`,
  `[memory_learning]`, and `[memory_hygiene]` in `agentbox.toml` — it never
  edits the manifest itself, only enforces the dry-run/flag contract against it.
