# Backup and Restore

Agentbox durable state splits across two independent backup paths:

1. **`agentbox.sh backup` / `restore`** — a manual, on-demand bundle of every
   *other* piece of durable state: the embedded ruvector cache, Solid pod
   tree, Nostr identities, workspace profiles, and the manifest itself. It
   also takes a logical `pg_dump` of the ruvector-postgres memory database as
   a convenience snapshot.
2. **The host systemd timer** (`ruvector-backup.timer`) — the **canonical**,
   scheduled backup of the ruvector-postgres memory database itself (the
   durable memory backend when `adapters.memory = "external-pg"`, which is
   the shipped default). See "Vector memory backups" below.

Treat them as complementary, not interchangeable: `agentbox.sh backup` is
what you run before a risky manifest change or a machine migration;
the systemd timer is what protects the 46k+ row memory store day to day
without you having to remember to run anything.

## Why this exists

The container image is disposable — you can always rebuild it. What matters is the state your agents have accumulated: vector memory rows, Solid-style pods, Nostr identities, the `workspace/profiles/` tree. `agentbox.sh backup` bundles those volumes into a single timestamped archive with a manifest, and `restore` puts them back. Secrets are excluded by default so the archive is safe to copy to object storage.

**What it solves**

- Moving an agentbox setup between machines without losing agent memory.
- Snapshotting before a risky manifest change or a major rebuild.
- Keeping identity keys out of routine backups unless you explicitly ask for them.

**When to skip `agentbox.sh backup`**: if `pods = "external"` too (fully federated with a host mesh), all your durable state lives outside this container — back it up there instead. With the shipped default (`pods = "local-solid-rs"`, `memory = "external-pg"`), keep running both this command *and* relying on the systemd timer below; they cover different failure modes (fast local rollback vs. off-host disaster recovery).

## What gets backed up

| Artefact | Default | `--include-secrets` |
|---|---|---|
| `agentbox-ruvector-data` volume (embedded per-session cache, SQLite) | yes | yes |
| `ruvector-postgres` logical dump (`pg_dump -Fc`, the durable memory DB — 46k+ rows) | yes, best-effort when the sidecar is reachable | same |
| `solid-data` volume (Solid pod tree under `/var/lib/solid` — served by `solid-pod-rs`) | always when `pods = local-solid-rs` | same |
| `agentbox-sovereign-identities` volume (Nostr keys) | **no** | yes |
| `workspace/profiles/` tree (minus key files) | yes | yes (full) |
| `agentbox.toml` | yes | yes |
| `/etc/supervisord.conf` from the running container | yes (best-effort) | yes |

Files always excluded from the profiles tree unless `--include-secrets`:
`*.key`, `*.pem`, `*.env`, `mgmt-key`

The `pg_dump -Fc` step is why a `agentbox.sh backup` can take minutes on a
large memory store — a raw volume tar of a live PostgreSQL datadir isn't
crash-consistent, so the archive carries a logical dump instead. If the
sidecar isn't reachable at backup time, the archive is created anyway with
`ruvector_pg_dump: false` in `MANIFEST.json` and a warning on stdout — it is
never a silent gap.

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
2. Runs `docker compose down` (using the same compose file set as the running stack — see below).
3. Writes volume data back via a throw-away `alpine:3.20` helper container.
4. Copies `agentbox.toml` and `workspace/profiles/` back from the archive.
5. Runs `docker compose up -d`, then waits for `ruvector-postgres` to accept connections and replays the memory DB with `pg_restore --clean --if-exists`.

**Compose file selection matters here.** `cmd_restore` always builds its
compose invocation from `COMPOSE_ARGS`, which includes
`docker-compose.override.yml` whenever that file is present — the override is
where `RUVECTOR_PG_CONNINFO` / `RUVECTOR_PG_PASSWORD` normally live. A bare
`docker compose -f docker-compose.yml up` (skipping the override) would
silently downgrade the memory sidecar connection to the default password.
Operational rule: always bring the stack up with the override file in play —
`./agentbox.sh up` / `restore` already do this for you; don't hand-roll a
`docker compose` invocation that drops it.

## Vector memory (RuVector PostgreSQL) backups — the canonical path

The scheduled, off-host-safe backup of the ruvector-postgres memory database
runs independently of `agentbox.sh`, as a host systemd timer:

```
ruvector-backup.timer   → OnCalendar=*-*-* 03:00:00, RandomizedDelaySec=900
ruvector-backup.service → runs /mnt/mldata/backups/ruvector-postgres/backup-ruvector.sh
```

The script:

1. Takes a single-instance lock (`flock`) so overlapping runs can't corrupt each other.
2. `pg_dump -U ruvector -d ruvector --clean --if-exists --no-owner | gzip -6` into a timestamped `.sql.gz`.
3. Verifies the result **before** touching anything else: file is non-empty, the gzip stream passes `gzip -t`, and the dump carries its `-- PostgreSQL database dump complete` completion marker.
4. Only after verification, prunes backups older than the 14-day retention window — and never prunes anything newer than the backup it just verified.

Restore from one of these dumps with a plain `pg_dump`-compatible replay:

```bash
gunzip -c /mnt/mldata/backups/ruvector-postgres/ruvector_<timestamp>.sql.gz \
  | docker exec -i ruvector-postgres psql -U ruvector -d ruvector
```

**Superseded / removed**: the old one-off dumps under the repo-root
`backups/` directory (Mar/Apr 2026) and the 2026-07-04 sidecar-update
rehearsal dump + snapshot volume have been deleted — the rolling systemd
timer replaces them as the canonical schedule. Per-operation recovery
archives generated by `./agentbox.sh ruvector <op>` (e.g.
`repair-namespaces-<ts>.copy.gz`, `archive-legacy-<ts>.copy.gz`) are a
separate, narrower thing — point-in-time snapshots taken immediately before
a specific hygiene op — and are kept under `backups/ruvector-sidecar/`. See
[agentbox-cli.md](agentbox-cli.md#ruvector--memory-sidecar-lifecycle) for
those.

## Running the smoke test

```bash
# Requires docker.  Exits 77 (skip) if docker is unavailable.
bash tests/backup/round-trip.sh
```

The test creates an isolated volume, seeds it with known content, runs the
backup helpers, destroys the volume, restores, and verifies MD5 checksums.
