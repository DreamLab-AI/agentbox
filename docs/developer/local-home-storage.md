# Local application storage

`~/.local` holds installed runtimes, XDG application data and state, including
Factrail decision records. It uses the disk-backed `agentbox-local-home` volume,
declared in the Nix Compose generator. It has no separate tmpfs capacity limit
and survives container replacement. OpenCode and code-server retain their
existing nested volumes; their data must not be copied into the parent volume.
Bootstrap already makes `.local` and `.local/share` writable by UID/GID 1000.

The previous 128 MiB tmpfs filled with an 89 MiB uv Python installation,
17 MiB of Godot logs and 21 MiB of decision records on 2026-11-09, despite
hundreds of GiB free on disk. Increasing `/tmp` cannot fix that separate mount.

## Existing containers

Run on the Docker host. Quiesce applications writing to `.local`, including
Factrail, Godot, uv and any user-installed tools. Leave Agentbox running during
capture: stopping it destroys the old tmpfs. Keep writers stopped until after
replacement so the capture remains current.

```sh
bash scripts/migrate-local-home.sh "$HOME/local-home-before-volume.tar"
bash scripts/refresh-compose.sh
# After preparing the new image, migrate the reviewed mount contract:
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps --force-recreate agentbox
```

The migration retains a private recovery archive, excludes the two nested
volumes, and refuses an existing destination volume or archive. A failed seed
retains the archive and any partially populated volume for inspection; it
does not delete or overwrite them on retry. New installations need no capture.
Never use `down -v`.

Fast activation rejects changes to persistent mounts. Use the explicit
Compose recreation above, then prepare again for later fast activations.
Verify `findmnt -T /home/devuser/.local` reports disk-backed storage, check
`df -h /home/devuser/.local`, and verify the retained application data before
discarding the recovery archive. This change requires container replacement;
updating builder sources alone does not change an existing mount.
