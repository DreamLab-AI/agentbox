---
id: ADR-2193
title: PID 1 starts through a launcher so that python3 is the runtime environment
date: 2026-11-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ca5b4152a7ea5d721ffa652a617970db64b4d303
verified_paths: []
owner: jjohare
review_trigger: a nixpkgs bump that changes how python applications are wrapped; any package placed ahead of pythonRuntimeEnv in allPackages that ships a python3; `AGENTBOX_RC_LIVE=1 bash tests/config/python-runtime-path.test.sh` passing in a rebuilt container (activation → live)
repo: agentbox
domain: BASELINE-container
relates: [ADR-2122]
evidence_class: test+runtime
acceptance_boundary: The test reproduces the defect and the fix with a throwaway supervisord run as devuser in the current container, and checks the flake text. It does not evaluate or build the flake (no Nix evaluator in the container), so the launcher derivation and the resulting image PATH are unbuilt until a host rebuild.
---

# ADR-2193: PID 1 starts through a launcher so that python3 is the runtime environment

## Context

`pythonRuntimeEnv` bakes numpy, pandas, yt-dlp and some thirty other packages, and its `bin` is on the image `PATH`. In every agent shell `python3 -c 'import numpy'` nevertheless failed. Cause: the entrypoint runs `exec supervisord`, which resolved to nixpkgs' wrapper script, and that wrapper prepends the bare interpreter's `bin` and the supervisor package's `bin` to `PATH`. supervisord hands its environment to every program, so every supervised process, tmux session and agent shell found the bare `python3` first. Skills worked around it with private virtualenvs or failed.

## Decision

`flake.nix` defines `supervisordLauncher`, a one-line `supervisord` script that runs `${pythonRuntimeEnv}/bin/python3 -s -m supervisor.supervisord "$@"`, and lists it ahead of `pythonRuntimeEnv` in `pythonBasePackages`. The entrypoint's `exec supervisord -c "$_AB_SUPERVISORD_CONF" -n` line is unchanged, so the custody checks that pin it (`tests/config/role-isolation-boot.test.sh`, `tests/runtime-contract/RC-X1-06.sh`, `scripts/ci/check-secret-not-in-env.sh`) are untouched. Invariant: in a supervised process the first `python3` on `PATH` is `pythonRuntimeEnv`.

## Consequences

- `python3`, `pip` and `supervisorctl` in agent shells now come from the runtime environment. It is the same 3.12 interpreter with site-packages, so scripts that ran before still run.
- `-s` keeps a user-site directory out of PID 1. Agent shells are unaffected by the flag.
- Programs that pin an interpreter by store path (`qgis_mcp_standalone.py`, the privacy filter, ComfyUI, the code interpreter) do not change.
- A package added ahead of `pythonRuntimeEnv` that ships its own `python3` would reintroduce the defect; the review trigger names it.

## Verification

Verified on an uncommitted working tree on top of `ca5b4152a7ea5d721ffa652a617970db64b4d303`; `verified_commit` names that base and `verified_paths` is empty until the change is committed and the record re-stamped at its own commit.

- `bash tests/config/python-runtime-path.test.sh`: 7 passed (1 live check skipped). Under the wrapper a supervised child's `python3` cannot import numpy; under the module launch it can, and `%(ENV_PATH)s` carries no prepended entry.
- `bash tests/config/role-isolation-boot.test.sh`: 22 passed. `bash tests/runtime-contract/RC-X1-06.sh`: 30 passed. `bash scripts/ci/check-secret-not-in-env.sh`: PASS.
- Not verified: a flake evaluation or image build.
