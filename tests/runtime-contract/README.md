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
