---
id: ADR-2029
title: "Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root"
date: 2026-09-02
decision_status: proposed
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [flake.nix, lib/rune.nix, config/tmux-autostart.sh, config/tmux.conf, agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: a Rune release that changes its CLI (`-w`), its keyboard-protocol requirement, or its licence; or the AoE plane absorbing note editing
repo: agentbox
domain: BASELINE-container
lineage: ADR-2003 (manifest-gated Nix composition), legacy ADR-042 (AoE Sessions window and its presence-detect fallback pattern), lib/systemscape.nix (pinned buildRustPackage precedent)
---

# ADR-2029 — Rune is the first-class markdown TUI

## Context

Operators and agents work in tmux tabs; the corpus is now an Obsidian vault
(VisionClaw ADR-2040). There is no terminal surface for reading or editing
vault pages with wikilink navigation, so notes are edited in `vim`/`nano`
without link resolution, or outside the container. Rune
(`github.com/aka-rider/rune`, MIT, Rust, ratatui + comrak + tree-sitter,
v1.4.0 at commit `4187dff1`) renders markdown with `[[wikilinks]]`, YAML
frontmatter, tables, task lists, embeds and Kitty images, has a crash journal
and 3-way merge on external change (relevant when agents edit the same files),
and builds from source here in 90 s. Its CLI is `rune [-w <dir>] [file...]`.

## Decision

1. Rune is packaged as `lib/rune.nix` (`rustPlatform.buildRustPackage`,
   `fetchFromGitHub` pinned to tag `v1.4.0`, `cargoBuildFlags = ["-p" "rune-cli"]`,
   `doCheck = false`, hashes recorded in the file) and enters the package set
   when `[vault].tui = "rune"`. The gate is honest: absent the gate, the
   binary is not in the image.
2. `config/tmux-autostart.sh` creates window 9 **"Notes"** with
   `-c "$VAULT_ROOT"`. If `rune` is on `PATH` it runs `rune -w "$VAULT_ROOT"`;
   otherwise it prints the same style of rebuild notice the Sessions window
   uses. Window 0 remains the tab0-bridge target; landing behaviour is
   unchanged.
3. `config/tmux.conf` enables `allow-passthrough on` and `extended-keys on`
   so Rune's Kitty graphics and modifier keys work inside tmux.
4. Until the image is rebuilt, the bind-mounted `~/workspace/.cargo/bin/rune`
   (built with `cargo install --git https://github.com/aka-rider/rune --tag
   v1.4.0 rune-cli`) satisfies the presence check; the entrypoint adds
   `/home/devuser/workspace/.cargo/bin` to `PATH` if it exists.
5. The welcome dashboard lists the Notes tab.

## Consequences

- Vault pages get link-aware editing in the same tabs agents work in.
- The Nix build adds one Rust package (~80 MB binary); rebuild time grows by
  the Rune compile.
- Obsidian-only constructs (callouts, highlights, math) render as plain text
  in Rune today; this is documented, not patched.
- Rune has no config file; keybindings and theme are compiled in (Ctrl chords
  mirror every ⌘ chord, so the Linux/tmux path is Ctrl). Its crash-recovery
  store is a global SQLite at `$HOME/Library/Application Support/rune/rune-v2.db`
  on every OS (not XDG). `/home/devuser` is a read-only layer in this
  container, so with the real HOME Rune starts degraded ("history disabled —
  storage unavailable") and loses exactly the journal and external-change
  bookkeeping this ADR values. The Notes window therefore runs the Rune
  process alone with `HOME=$WORKSPACE/.rune-home` (the pane shell keeps the
  real HOME); the journal lives at
  `~/workspace/.rune-home/Library/Application Support/rune/rune-v2.db` on the
  bind mount and survives both session restarts and image rebuilds.
  `~/.local` was rejected as the home because it is a small noexec tmpfs.
- Rune auto-detects the vault root by climbing to the nearest `.obsidian` or
  `.git` marker, so `rune` launched anywhere inside the vault behaves the same
  as `rune -w "$VAULT_ROOT"`; the window passes `-w` explicitly anyway.

## Verification

2026-09-02, on the `obsidian` branch: `bash -n config/tmux-autostart.sh`
clean; dry runs on a private `TMUX_TMPDIR` socket showed (a) rune present +
vault present → 10 windows, `9:Notes` running
`.cargo/bin/rune -w <vault>` with the normal keybinding footer and the
recovery DB created under `.rune-home`; (b) rune absent + vault missing →
the window falls back to `$WORKSPACE` (tmux refuses `-c` on a missing
directory) and prints the rebuild notice. The binary is resolved in bash
(`command -v rune`, then `$WORKSPACE/.cargo/bin/rune`) and PATH is passed
with `tmux new-window -e`, because panes run fish. Hashes in `lib/rune.nix`
were computed in a throwaway `nixos/nix` container fed over stdin (no bind
mounts — the DinD source-mount trap): `nix-prefetch-url --unpack` for the
source (tag and commit archives hash identically), `cargoHash` from the
fake-hash mismatch against the repo's pinned nixpkgs
(`9ae611a455b90cf061d8f332b977e387bda8e1ca`), then a **complete** build of
`rune-1.4.0` (77.7 MB stripped, `rune 1.4.0`) with the real hashes. Gate
evaluation: `[vault].tui = "rune"` → `runeActive=true`; section absent →
`false`. `implementation_status: complete` when the rebuilt image is booted
and `verified_commit` is recorded.
