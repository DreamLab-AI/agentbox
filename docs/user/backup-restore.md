# Backup and Restore

`agentbox.sh` ships two verbs — `backup` and `restore` — for snapshotting and
recovering the durable state of a running agentbox stack.

## Why this exists

The container image is disposable — you can always rebuild it. What matters is the state your agents have accumulated: vector memory rows, Solid-style pods, Nostr identities, the `workspace/profiles/` tree. `agentbox.sh backup` bundles those volumes into a single timestamped archive with a manifest, and `restore` puts them back. Secrets are excluded by default so the archive is safe to copy to object storage.

**What it solves**

- Moving an agentbox setup between machines without losing agent memory.
- Snapshotting before a risky manifest change or a major rebuild.
- Keeping identity keys out of routine backups unless you explicitly ask for them.

**When to skip this**: if you run with `adapters.memory = "external-pg"` and `pods = "external"`, your durable state already lives in the host mesh — back it up there and skip this command.

## What gets backed up

| Artefact | Default | `--include-secrets` |
|---|---|---|
| `agentbox-ruvector-data` volume (SQLite cache) | yes | yes |
| `solid-data` volume (Solid pod tree under `/var/lib/solid` — served by `solid-pod-rs` by default) | always when `pods ∈ {local-solid-rs, local-jss}` | same |
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
