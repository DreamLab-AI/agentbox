# lib/vault.nix
#
# `vault` — the ONE door agents and CI have onto the sovereign corpus
# (PRD-sovereign-corpus Q10/Q11; agentbox ADR-2107 / ADR-2108).
#
# Subcommands, per interface contract C2: validate, find, retrieve, tree,
# edit --expect, propose, gate, conflicts, build, migrate. Everything that the
# retired `ontology-bridge` MCP server used to answer, and several things it
# could not: guarded mutation with a declared blast radius, the autonomous
# quality gate, the conflict detector, and the whole build.
#
# WHY THIS FILE EXISTS AT ALL, given the crate is not ours
# -------------------------------------------------------
# The crate's home is `crates/vault` in the VisionClaw workspace — i.e. the
# PARENT of this submodule — because it shares the OntologyBlock parser and
# Whelk-rs with VisionClaw's ingest, so the corpus is parsed and reasoned by one
# implementation (Q11). agentbox's flake root is the submodule directory, and a
# flake may not read a path outside its own source tree, so `src = ../../crates/vault`
# is not an option: it evaluates to a path Nix refuses to copy into the store.
#
# So the source arrives as a flake INPUT (`vaultSrc`, `flake = false`), exactly
# the mechanism `skills` already uses for the skills corpus, and the derivation
# below takes it as an argument. That keeps three properties:
#
#   1. The binary is part of the immutable runtime — never a mutable
#      `~/workspace/.cargo/bin/vault` the host happens to have built. Same
#      discipline as lib/rune.nix states in its header.
#   2. The pin is content-addressed: flake.lock records the narHash, so the
#      image's `vault` is a specific tree, and `nix flake metadata` says which.
#   3. Repointing is one line. When the crate is pushed, flip the input to
#      `github:DreamLab-AI/VisionClaw/<rev>?dir=crates/vault` and nothing here
#      changes — `src` is still just the input.
#
# The input is declared in flake.nix. To build against an uncommitted working
# tree instead of the pin:
#
#   nix build .#packages.x86_64-linux.vault \
#     --override-input vaultSrc path:/home/devuser/workspace/project/crates/vault
#
# cargoLock
# ---------
# `cargoLock.lockFile` wants a path Nix can read at EVALUATION time, and an
# input's files are exactly that, so `src + "/Cargo.lock"` is legal and needs no
# vendored copy the way lib/systemscape.nix keeps one (systemscape's source is a
# fetchFromGitHub, which is not readable during evaluation). If WS-C's crate
# ever grows a `git+` dependency, add `cargoLock.outputHashes` here — registry
# checksums in the lock cover everything else.
#
# doCheck
# -------
# On. The crate's suite is hermetic by construction: it runs against committed
# corpus fixtures and tempdirs, and the golden build-parity tests compare its
# output to the frozen Python pipeline output. Those are precisely the tests
# that must not be skipped — a `vault build` that silently stops matching the
# bundle Loom loads is the failure mode this whole workstream exists to prevent.
#
# Licence: the crate is AGPL-3.0-only like its VisionClaw siblings; recorded
# here and in docs/developer/licensing.md alongside the other AGPL daemons.

{ lib, pkgs, src, version ? "0.1.0" }:

pkgs.rustPlatform.buildRustPackage {
  pname = "vault";
  inherit version;

  # `src` is the flake input (crates/vault). Strip build detritus so a stray
  # target/ in an overridden working tree cannot change the derivation hash.
  src = lib.cleanSourceWith {
    inherit src;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

  cargoLock.lockFile = src + "/Cargo.lock";

  doCheck = true;

  meta = with lib; {
    description =
      "vault — the sovereign corpus CLI: OKF validation, frontmatter graph retrieval, guarded edits, governed proposals, quality gate, conflict detection and the corpus build";
    homepage = "https://github.com/DreamLab-AI/VisionClaw";
    license = licenses.agpl3Only;
    mainProgram = "vault";
    platforms = platforms.linux;
  };
}
