# Runtime contract tests

Validates PRD-002 (immutable bootstrap) and PRD-003 (runtime contract and hardening).

## Suite shape

Two implementation layers:

- **Bash scripts** (`RC-002-*.sh`, `RC-003-*.sh`) — drive Docker lifecycle: start container,
  block network, inspect output, tear down. Each script is self-contained and idempotent.
- **Jest specs** (`RC-003-07.spec.js`, `RC-003-08.spec.js`) — HTTP probe assertions against
  a container started by the surrounding bash harness or by `beforeAll`. Use `node-fetch`
  (no extra frameworks) so the suite has zero compile step.
- **jq snippets** inside the bash scripts parse `docker inspect` JSON for hardening fields.

## Naming convention

```
RC-<PRD-number>-<two-digit-sequence>[.<ext>]
```

The sequence numbers match the test IDs in PRD §6. Every file name is the primary key for
CI reporting and failure triage.

## Skip pattern

Tests that require a running Docker daemon, a GPU, or a registry image export the
`SKIP_<CAPABILITY>` guard at the top:

```bash
[ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ] && \
  { echo "SKIP: no Docker socket"; exit 77; }
```

Exit code 77 is the TAP skip convention; CI treats it as a neutral result, not a failure.
Jest equivalents use `test.skip` gated on `process.env.SKIP_DOCKER`.

## Predicates each test asserts

| ID | Predicate |
|----|-----------|
| RC-002-01 | `GET /ready` returns 200 within 60 s with `--network none` |
| RC-002-02 | Each feature binary present in PATH; `--version`/`--help` exits 0; no new `node_modules` under `/opt/agentbox` after boot |
| RC-002-03 | Zero matches for installer patterns in `config/entrypoint-unified.sh` |
| RC-002-04 | Boot reaches readiness with `/opt/agentbox` read-only bind mount; no write errors logged |
| RC-002-05 | Missing required binary causes supervisord exit non-zero and stderr matches `FATAL:.*missing` |
| RC-003-06 | Both local and registry `AGENTBOX_IMAGE_REF` values reach `/ready` HTTP 200 |
| RC-003-07 | `/livez` 200 before adapter ready; `/ready` 503 with `detail`; both 200 after |
| RC-003-08 | Metrics port from manifest appears in compose ports, is bound, returns Prometheus text |
| RC-003-09 | `docker inspect`: `User != 0`, `ReadonlyRootfs true`, `CapDrop` has `ALL`, ≥2 tmpfs mounts |
| RC-003-10 | Desktop exception adds tmpfs entries without removing baseline `cap_drop: ALL` |
| RC-X1-01 | Root boot PATH is store-only: a probe planted in `~/workspace/.cargo/bin` never runs as root; devuser shells get the cargo bin appended |
| RC-X1-02 | Stage B is one-shot per container start (root 0700 sentinel dir in sticky `/tmp`); a `supervisorctl start bootstrap` replay is a no-op |
| RC-X1-03 | Baked `/etc/group` gives `root` no members; live (`AGENTBOX_RC_LIVE=1`): `id -G devuser` lacks 0 |
| RC-X1-04 | `chmod o+rw` on the Docker socket only with `[security].role_isolation` off; on, a still-widened socket is reported `degraded:docker-socket` |
| RC-X1-05 | `config/docker-read-proxy.cjs`: GET-only allowlist (fixtures), 403 never reaches the daemon, real `docker` CLI ps/inspect/logs pass and exec/run fail |

The RC-X1 tests (custody X-1 step 1, workstream W0) need no container: they extract
the entrypoint functions by name and run them against a scratch filesystem.

```bash
for f in tests/runtime-contract/RC-X1-0*.sh; do bash "$f"; done
node --test tests/runtime-contract/RC-X1-05.node-test.cjs
```

### Host-half contract for the role-isolation rehearsal (R2)

The Docker socket inside the container is a bind of the **host's**
`/var/run/docker.sock` inode. Every boot before W0 ran `chmod o+rw` on it, so the
host socket is world-writable until someone narrows it **on the host**. Turning
`[security].role_isolation` on stops the container widening it but never narrows
it (that is the owner's host-side decision, Q2). Until the host runs
`chmod 0660 /var/run/docker.sock` (or the Docker daemon restarts and recreates it),
the boot writes `degraded:docker-socket` to `/run/secrets/role-isolation.state` and
logs `ROLE-ISOLATION-DEGRADED docker-socket`. The rehearsal's host half
(`scripts/activation/role-isolation-rehearsal.host.sh`, W6a) must report the host
socket's mode and owner and treat anything with other-bits set as a failed check;
the in-container half must treat `degraded:docker-socket` as red.

## Running locally

```bash
# All bash tests (requires Docker socket)
for f in tests/runtime-contract/RC-*.sh; do bash "$f"; done

# Jest HTTP probes (start a container first)
AGENTBOX_MGMT_PORT=9090 npx jest tests/runtime-contract/

# Single test
bash tests/runtime-contract/RC-002-03.sh
```

Runtime budget: each test must complete within 60 s. Tests that start a container
must remove it in a `trap ... EXIT` block.

## CI wiring

Tests run as a job in `.github/workflows/build-multi-arch.yml` after the
`publish-image` step, on both `ubuntu-latest` (amd64) and `ubuntu-24.04-arm` (arm64).
The job sets `AGENTBOX_IMAGE_REF` to the SHA-tagged image produced by the publish step.
