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
| `migrate-workspace` | One-shot rsync from the legacy `multi-agent-docker_workspace` volume into `agentbox-workspace`, then patches the override file |
| `preflight` | Validate the local environment and manifest before `up`: compose merge, Nix flake eval (W021 audit gate), host bind targets, external volumes |

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
