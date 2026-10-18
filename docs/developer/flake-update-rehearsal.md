# Flake-update rehearsal (X-4)

The weekly `nix-flake-update` workflow force-pushes `deps/nix-flake-update`. This rehearsal builds that
branch, boots it in a throwaway container and checks the manifest gates before anyone merges it.

## Run it

On the **host** shell (never inside the container: a build there bakes stale code), from the live checkout:

```
scripts/activation/flake-update-rehearsal.host.sh --journal
```

It needs `nix`, `docker`, `git` and `jq`; it does not need root. Flags: `--branch`, `--remote`, `--boot-timeout S`
(default 600), `--keep`, `--journal`, `--live-url`, `--receipt-dir`, `--allow-dirty`. With `--journal`, export the
live box's `MANAGEMENT_API_KEY` first.

## What it does

1. Fetches the branch into a throwaway `git worktree` and refuses (exit 3) if it is absent.
2. `nix build <worktree>#runtime`, then loads the image as `agentbox:rehearsal-<sha12>` with
   `nix run <worktree>#runtime.copyTo -- docker-daemon:…`. It never uses `copyToDockerDaemon`, which would
   overwrite the live `agentbox:runtime-<system>` tag; the receipt records `live_image_untouched`.
3. Boots `agentbox-rehearsal-<sha12>` on its own `--internal` network: no published port, no workspace, secrets
   or Docker socket, a random management-api key. The only bind is the branch's `agentbox.toml`, read-only; the
   paths `/ready` checks are tmpfs.
4. Waits for management-api, then records gates: `build`, `boot`, `ready` (`GET /ready`) and one `unit:<id>` per
   catalogue entry with a supervisor service, judged declared-vs-running as
   `scripts/ci/check-declared-vs-running.js` does. A unit this box cannot read (a compose sidecar) is
   `not_evaluable`, never a pass.
5. Writes `docs/estate-closeout/x4-rehearsal-<UTC>.json` (schema `docs/estate-closeout/schema/x4-rehearsal.schema.json`).
6. With `--journal`, posts one `/v1/exec/record` entry per gate to the live box. An unreachable or refusing
   journal is non-fatal and recorded in the receipt.
7. Removes the container, network and image unless `--keep`; the worktree is always removed.

## Verdicts

| Exit | Verdict | Meaning |
|---|---|---|
| 0 | PASS | every gate passes |
| 1 | FAIL | the build, the boot or a gate failed |
| 2 | STAGED | built and booted; some gates are not evaluable in an isolated box. Read the receipt's `unevaluated_gates` |
| 3 | COULD_NOT_RUN | branch absent, no docker or nix, or run from inside a container |

Merge on 0, or on 2 once the unevaluated gates are understood. Do not merge on 1 or 3.

## Limits

No ruvector-postgres, GPU or sidecar is started, so gates that need them fail or are not evaluable; compare with
the receipt from the previous green run. Closure identity (ADR-2077) is not judged here.

Test: `bash tests/config/flake-update-rehearsal.test.sh` (fakes for docker, git, nix and curl).
