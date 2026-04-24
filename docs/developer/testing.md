# Testing

Agentbox ships ~200 tests across nine categories. This doc covers how to run them and how to add your own.

## Suite layout

```
tests/
├── contract/              # Adapter contract tests (Jest) — 5 slots × 3 impls
├── integration/           # Multi-component integration (Jest)
├── sovereign/             # Nostr-bridge integration (Jest)
├── runtime-contract/      # PRD-002/003 end-to-end (bash + Jest)
├── config/                # Validator semantic-rule tests (Jest)
├── tui/                   # Python TOML round-trip (pytest)
├── artifact-probes/       # Per-feature binary-exists probes (bash)
├── bootstrap/             # Entrypoint lifecycle tests (bash)
├── cli/                   # agentbox.sh smoke tests (bash)
├── flake/                 # Nix eval + generator tests (bash)
├── cuda/                  # nvidia-smi smoke (bash)
├── 3dgs/                  # COLMAP + METIS smoke (bash)
├── toolchains/            # blender + latex presence (bash)
├── security/              # gitleaks canary (bash)
├── reproducibility/       # nix-build-hash equality (bash)
├── backup/                # backup/restore round-trip (bash)
└── observability/         # metrics registry (Jest)
```

## Running

### JavaScript suites

```sh
cd management-api
npm test                              # full Jest run
npx jest tests/contract               # narrower
npx jest tests/contract/beads.contract.spec.js       # single file
npx jest --ci --forceExit             # what CI runs
```

### Python TUI tests

```sh
cd tests/tui
pip install -r requirements.txt       # pytest 8.3.5
pytest -v test_tui_helpers.py
```

### Bash suites

Each is self-contained, executable, TAP-output:

```sh
bash tests/runtime-contract/RC-002-03.sh       # pure file-lint, no Docker
bash tests/cli/smoke.sh
bash tests/reproducibility/nix-build-hash.sh   # requires Nix
bash tests/backup/round-trip.sh                # requires Docker
```

### Skip semantics

Bash tests exit:
- `0` — all assertions passed
- `1` — real failure
- `77` — skipped (missing Docker / Nix / GPU / etc.)

TAP output: `ok N` / `not ok N` / `ok N # SKIP reason`. Final line `1..N` summary.

### Running everything locally

```sh
# JavaScript
(cd management-api && npm test -- --ci)

# Python
(cd tests/tui && pytest)

# Bash (tolerates skip-77)
for f in tests/**/*.sh; do
  bash "$f" || [ $? -eq 77 ] || echo "FAIL: $f"
done
```

## CI workflows

| Workflow | Trigger | Runs |
|---|---|---|
| `contract-tests.yml` | PR | Jest contract + integration + observability |
| `tui-tests.yml` | PR | pytest TUI |
| `secret-scan.yml` | PR | gitleaks + canary |
| `flake-check.yml` | PR | `nix flake check --no-build` on amd64 + arm64 |
| `build-multi-arch.yml` | push to main, release | Nix build + GHCR publish (both arches) |
| `nix-flake-update.yml` | Mon 06:00 UTC | `nix flake update` → PR |

Failure in any PR workflow blocks merge.

## Runtime-contract test matrix

Maps 1:1 to PRD-002/003 acceptance criteria.

| Test | AC | What it proves |
|---|---|---|
| RC-002-01 | No-network boot | `docker run --network none` → `/ready` returns 200 |
| RC-002-02 | Artifact probes | Every enabled feature's binary exists + runnable |
| RC-002-03 | Install-lint | Zero `npm install` / `pip install` in entrypoint |
| RC-002-04 | Legal-write boundary | `/opt/agentbox:ro` mount → boot still reaches readiness |
| RC-002-05 | Missing-artifact fatal | Unlinking a required binary → supervisord exits non-zero |
| RC-003-06 | Image ref local + registry | Both `AGENTBOX_IMAGE_REF` cases reach `/ready` |
| RC-003-07 | Probes distinct | Delayed-adapter: `/livez` 200 + `/ready` 503; both 200 after |
| RC-003-08 | Metrics port chain | Manifest → compose → container → host |
| RC-003-09 | Hardening baseline | `docker inspect` shows non-root + read_only + cap_drop ALL |
| RC-003-10 | Exception merge | Desktop tmpfs union works; baseline drops preserved |

## Coverage scorecard

Current (2026-04-24):

| Category | Tests | Passing | Todo/Skip |
|---|---|---|---|
| Contract harness | 178 | 145 | 33 (infra-blocked) |
| Semantic rules | 50 | 49 | 1 (Nix-eval) |
| Runtime-contract | 10 | 10 | 0 |
| Bootstrap | 4 | 4 | 0 |
| Integration | 16 | 16 | 0 |
| TUI pytest | 23 | 23 | 0 |
| Artifact probes | 15 | 15 | 0 |
| Other bash | ~11 | all (skip-77 unless Docker) | — |

**33 contract todos** legitimately pending on external infrastructure:
- k6 load harness for SLO tests (×15)
- Community Solid Server + WAC for permission-denied (×3)
- ONNX runtime for embedding-error path (×3)
- SSD-backed CI runner for JSONL timing (×3)
- Dedicated HW + synthetic agent for orchestrator SLO (×9)

Each todo carries a one-line note citing the specific missing dependency.

## Adding a test

### New validator rule

1. Add the rule to `scripts/agentbox-config-validate.js` with next-in-sequence error code.
2. Add a `describe` block to `tests/config/semantic-rules.test.js` with invalid + valid cases.
3. Document in ADR-005 §Validation or ADR-007 §4a.

### New adapter impl

See [adapters.md](adapters.md) §Testing. Contract suite runs automatically once the file exists at `management-api/adapters/<slot>/<impl>.js`.

### New PRD acceptance test

1. If PRD-002/003 AC, use next `RC-NNN-NN.sh` slot.
2. Use existing `RC-*.sh` files as templates (TAP output, skip-77).
3. Add row to the matrix above.
4. Add to `contract-tests.yml` if it should run per-PR.

## Debugging flaky tests

- Isolate: `npx jest <file> --ci --forceExit`
- Port collisions (integration uses `portfinder`; re-runs can leak) — verify nothing stale before rerun.
- Race conditions in adapter `connect()` — test harness accepts `AGENTBOX_TEST_ADAPTER_DELAY_MS` for deterministic timing.
- Bash — add `set -x` at the top for trace.
- Contract tests use `jest --runInBand` in CI to avoid parallel contention.

## Pre-merge checklist

```sh
# Lint
npx eslint management-api/

# Tests
(cd management-api && npm test -- --ci)
(cd tests/tui && pytest)

# Validator
node scripts/agentbox-config-validate.js

# Compose regen (if you touched flake.nix)
nix build .#compose && diff result/docker-compose.yml docker-compose.yml
```

CI reruns all of this, but local is faster.
