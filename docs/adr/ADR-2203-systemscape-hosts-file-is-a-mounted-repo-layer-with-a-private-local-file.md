---
id: ADR-2203
title: The SystemScape hosts file is a mounted repo layer with a private local file
date: 2026-11-18
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 2ebc3859c77fce7996eb584d78a2b89c286d72c2
verified_paths: [config/systemscape/README.md, config/systemscape/hosts.example.toml, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, lib/systemscape.nix, lib/systemscape-Cargo.lock, tests/config/systemscape-hosts-layer.test.sh, tests/config/systemscape-hosts-boot.test.cjs]
owner: operator
review_trigger: the SystemScape pin moves to 0.4.0 or later, or a second consumer of config/systemscape/ appears
repo: agentbox
evidence_class:
acceptance_boundary:
---

# ADR-2203 — The SystemScape hosts file is a mounted repo layer with a private local file


## Scoped source verification — 2026-11-20

Reviewed the governed-path delta through `2ebc3859c77fce7996eb584d78a2b89c286d72c2` against the
[core-tool and browser source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).
The change is limited to pinned tool packaging, the existing MetaHarness gate's
offline CLI, descriptive schema/catalogue text, bounded System-pane startup,
and honest classification of existing credentials. It changes no adapter,
listener, role authority, model policy or retrieval geometry. Existing decision,
implementation and activation axes and unrelated acceptance limits remain;
this is not a new whole-record runtime or role-isolation rehearsal.


## Scoped package check — 2026-11-18 (SystemScape 0.5)

The new source pin is `7faffcd29a13f5d0d217434a6e7fafe8407492a1`, version
0.5.0. Host prefetch confirms `sha256-t+7REjvDMzmAzQhJJB6VxDn/ni0BRHR0e2Ti7V8bA/Q=`;
the vendored lock is byte-identical. The standalone Nix build passed 183 tests
with one upstream ignored test, and reports 0.5.0. Eight public/private-layer
checks and the actual boot-link fixture pass. Mounts and boot-link semantics
are unchanged. This verifies the package update, not the pending 0.5 image
activation or any new acceptance/status promotion.

## Context
SystemScape 0.4.0 can watch other machines in its telemetry view. A hosts file
lists them, and each one's `systemscape --probe` is read over OpenSSH. The
default path is `~/.config/systemscape/hosts.toml`. In this container
`~/.config` is not persisted, `agentbox.toml` is tracked in a public
repository, and the file names real addresses and users. ADR-2118 already
solved the same shape for instruction tiers: a tracked public layer plus a
gitignored `local/`, mounted read-only and never baked into the image.

## Decision
- `config/systemscape/` is mounted read-only at `/etc/agentbox/systemscape`
  through the flake's baseline mounts and the generated compose. It holds a
  tracked `README.md` and `hosts.example.toml` (placeholders only) and a
  gitignored `local/hosts.toml` (the operator's machines).
- At boot, when `local/hosts.toml` exists, the entrypoint links
  `~/.config/systemscape/hosts.toml` to it. When it does not, a link the
  entrypoint made is removed. A regular file at that path is never replaced.
- The System pane command does not name the file. A pinned binary older than
  0.4.0 rejects unknown flags and would exit in a loop; with the default-path
  link it simply ignores the file.
- No `agentbox.toml` gate: the file existing is the switch. SSH credentials
  come from the persisted `~/.ssh` mount; the hosts file holds no secret.

## Consequences
- An operator adds machines by editing one private file; it takes effect at
  the next boot, and `systemscape --hosts /etc/agentbox/systemscape/local/hosts.toml`
  checks it without a reboot.
- The mount is rebuild-class: it lands with `./agentbox.sh rebuild`.
- The feature is inert until the SystemScape pin moves to 0.4.0 (rev, NAR
  hash, version and the vendored `lib/systemscape-Cargo.lock`), which needs
  the upstream commit pushed and a host-side prefetch.
- With the pin moved and a file present, the always-on System pane probes the
  listed machines continuously, including `nvidia-smi` every `gpu_interval`.

## Verification
- `bash tests/config/systemscape-hosts-layer.test.sh`: 8 passed. It checks the
  ignore rule, no tracked `local/` files, no estate specifics in tracked
  files, the mount in both flake and compose, the entrypoint link and that the
  System pane names no flag.
- The entrypoint block was exercised against temporary paths: no source, link,
  idempotent rerun, removal of its own link and preservation of a hand-written
  file.
- Not yet verified: a host `nix build .#compose`, a rebuilt image booting with
  the mount, and the pinned 0.4.0 binary in the System pane.

### Host package verification — 2026-11-18

Upstream fbd780511de2c3d264d53b8cb097f983b8ec156c is pushed, pinned at 0.4.0,
and host-prefetched with NAR hash
`sha256-hvAQpf+9SfBfSvHL70wmDyfD3YxTgvKxSVwwUCTapko=`. The lock copy is
byte-identical. `nix build .#systemscape` passed all 49 tests and the binary
reports 0.4.0. The actual boot block also passed temporary-filesystem tests for
absence, linking, repeat execution, link removal, regular-file preservation
and preservation of an unrelated dangling symlink. Image/production activation
evidence is deliberately not claimed by this source-only verification.

## Re-verification — 2026-11-20 at `9263a39761c0c69e651e77ec1c91be33f015a1b5`

Governed delta: `config/entrypoint-unified.sh` changed in one block: the browser-gpu registration probe (~:2248) now accepts HTTP 200 or 503 from `http://browsercontainer:8931/health` instead of `curl -f` (ADR-2207 D5), a net +2 lines, so every line after ~:2248 sits two lines lower. Nothing else in the file moved. The SystemScape hosts link is untouched. The Decision is unchanged and no claim of this record is falsified by the ADR-2207 sidecar refresh. Commands run: `git diff f97628381..9263a3976 -- config/systemscape/README.md config/systemscape/hosts.example.toml config/entrypoint-unified.sh flake.nix docker-compose.yml lib/systemscape.nix lib/systemscape-Cargo.lock tests/config/systemscape-hosts-layer.test.sh tests/config/systemscape-hosts-boot.test.cjs`; `bash -n config/entrypoint-unified.sh` → clean. Re-run the diff to reproduce.
