# Rune — the first-class markdown TUI for the vault (ADR-2029).
#
# Pin source and Cargo dependencies so the Notes window's editor is part of the
# immutable Agentbox runtime rather than depending on a mutable workspace
# checkout (`~/workspace/.cargo/bin/rune` is the pre-rebuild interim only).
#
# Built from the DreamLab fork (jjohare/rune, branch `dreamlab`, cut from
# upstream v1.5.0): Obsidian callouts, ==highlights== and #tags, a backlinks
# panel (F3), vault-wide shortest-path link resolution, and daily notes (F4,
# `--today`, Templater date tokens) that the Notes window relies on.
#
# Workspace of 12 crates; only the `rune-cli` member produces the `rune` binary,
# so the build is narrowed with cargoBuildFlags. Tests are skipped here (the
# fork's own `make test` gates each tag); upstream's flake does the same.
# Cargo.lock has no `git+` sources, so vendoring straight from the pinned
# lockfile needs no outputHashes.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "rune";
  version = "1.5.0-dreamlab.1";

  src = pkgs.fetchFromGitHub {
    owner = "jjohare";
    repo = "rune";
    # tag v1.5.0-dreamlab.1
    rev = "2698873b1961877a2a1627e98b11929334b51e28";
    hash = "sha256-RDj8TCdJdicGGZNejndtaoQehveP+Gif1NH/bDTwDis=";
  };

  cargoLock.lockFile = "${src}/Cargo.lock";
  cargoBuildFlags = [ "-p" "rune-cli" ];
  doCheck = false;

  meta = {
    description = "TUI markdown editor with wikilink navigation for the vault";
    homepage = "https://github.com/jjohare/rune";
    license = lib.licenses.mit;
    mainProgram = "rune";
    platforms = lib.platforms.linux;
  };
}
