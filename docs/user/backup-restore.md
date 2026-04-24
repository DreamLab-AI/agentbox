# Backup and Restore

`agentbox.sh` ships two verbs — `backup` and `restore` — for snapshotting and
recovering the durable state of a running agentbox stack.

## What gets backed up

| Artefact | Default | `--include-secrets` |
|---|---|---|
| `agentbox-ruvector-data` volume (SQLite cache) | yes | yes |
| `agentbox-solid-data` volume (local JSS pods) | only when `pods = "local-jss"` | same |
| `agentbox-sovereign-identities` volume (Nostr keys) | **no** | yes |
| `workspace/profiles/` tree (minus key files) | yes | yes (full) |
| `agentbox.toml` | yes | yes |
| `/etc/supervisord.conf` from the running container | yes (best-effort) | yes |

Files always excluded from the profiles tree unless `--include-secrets`:
`*.key`, `*.pem`, `*.env`, `mgmt-key`

## Creating a backup

```bash
# Default: timestamped archive in ./backups/
./agentbox.sh backup

# Custom output path
./agentbox.sh backup --out /mnt/nas/agentbox-$(date +%F).tgz

# Include secrets (Nostr keys, mgmt-key files)
./agentbox.sh backup --include-secrets
```

The archive includes a `MANIFEST.json` with the timestamp, inclusion flags, and
a list of exclusions so a future restore can validate the archive before
touching any volumes.

## Restoring

```bash
# Interactive — prompts y/N before overwriting volumes
./agentbox.sh restore ./backups/agentbox-backup-20260101T000000Z.tgz

# Non-interactive (CI, scripts)
./agentbox.sh restore ./backups/agentbox-backup-20260101T000000Z.tgz --force
```

Restore automatically:
1. Validates `MANIFEST.json` inside the archive.
2. Runs `docker compose down`.
3. Writes volume data back via a throw-away `alpine:3.20` helper container.
4. Copies `agentbox.toml` and `workspace/profiles/` back from the archive.
5. Runs `docker compose up -d`.

## Running the smoke test

```bash
# Requires docker.  Exits 77 (skip) if docker is unavailable.
bash tests/backup/round-trip.sh
```

The test creates an isolated volume, seeds it with known content, runs the
backup helpers, destroys the volume, restores, and verifies MD5 checksums.
