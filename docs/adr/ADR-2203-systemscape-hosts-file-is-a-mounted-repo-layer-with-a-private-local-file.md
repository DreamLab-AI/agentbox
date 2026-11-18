---
id: ADR-2203
title: The SystemScape hosts file is a mounted repo layer with a private local file
date: 2026-11-18
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: de01d60a408b9eb057a3b6257aabd9f764671c94
verified_paths: [config/systemscape/README.md, config/systemscape/hosts.example.toml, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, lib/systemscape.nix, lib/systemscape-Cargo.lock, tests/config/systemscape-hosts-layer.test.sh, tests/config/systemscape-hosts-boot.test.cjs]
owner: operator
review_trigger: the SystemScape pin moves to 0.4.0 or later, or a second consumer of config/systemscape/ appears
repo: agentbox
evidence_class:
acceptance_boundary:
---

# ADR-2203 — The SystemScape hosts file is a mounted repo layer with a private local file

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
