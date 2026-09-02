# Rune — the first-class markdown TUI for the vault (ADR-2029).
#
# Pin source and Cargo dependencies so the Notes window's editor is part of the
# immutable Agentbox runtime rather than depending on a mutable workspace
# checkout (`~/workspace/.cargo/bin/rune` is the pre-rebuild interim only).
#
# Workspace of 12 crates; only the `rune-cli` member produces the `rune` binary,
# so the build is narrowed with cargoBuildFlags. Tests are skipped: the suite is
# TUI-interactive and upstream's own flake sets doCheck = false.
# Cargo.lock at v1.4.0 has no `git+` sources, so the registry vendor FOD
# (cargoHash) is sufficient — no cargoLock.outputHashes needed.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "rune";
  version = "1.4.0";

  src = pkgs.fetchFromGitHub {
    owner = "aka-rider";
    repo = "rune";
    # tag v1.4.0
    rev = "4187dff138c4cdd9d4260b04690ebe0a1dd0eab2";
    hash = "sha256-Yr7BhZMyHcs4NsWgYv0do7FSz4g4/92po+YzBhdVR6s=";
  };

  cargoHash = "sha256-5GBKst24sCAdla3b2HWJfCKlLkv6HN74v2dya1U9Ej8=";
  cargoBuildFlags = [ "-p" "rune-cli" ];
  doCheck = false;

  meta = {
    description = "TUI markdown editor with wikilink navigation for the vault";
    homepage = "https://github.com/aka-rider/rune";
    license = lib.licenses.mit;
    mainProgram = "rune";
    platforms = lib.platforms.linux;
  };
}
