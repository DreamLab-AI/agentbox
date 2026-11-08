# lib/statcraft.nix
#
# Nix derivation for statcraft-run: a headless runner over StatCraft
# (kobaltgit/StatCraft), a pure safe-Rust, SPSS-compatible statistics engine.
# Gate: [skills.data_science].statcraft. Skill: skills/statcraft.
#
# Why a runner and not upstream's `--mcp` mode: StatCraft's MCP server
# (statcraft_bridge::mcp) only proxies tool calls to a running desktop GUI on
# 127.0.0.1:18493 and answers "StatCraft GUI is not running" otherwise. The
# engine itself (statcraft_syntax's SyntaxDispatcher over CommandBus) has no GUI
# dependency, so lib/statcraft/statcraft_run drives it directly: load a CSV, TSV,
# SAV or XLSX file, execute SPSS syntax, print every command's result as JSON.
#
# The build trims upstream's workspace to the engine crates (core, io, algo,
# syntax) plus the runner (lib/statcraft/workspace.Cargo.toml), so no GUI crate
# (egui, wgpu) is vendored or compiled. Upstream gitignores Cargo.lock; the
# vendored lockfile is the one the runner was built and verified with: 86
# crates.io packages, no git sources, no native libraries.
#
# To bump: move `rev`, refresh `hash` (NAR sha256 of the commit tarball:
# nix-prefetch-url --unpack, then `nix hash convert --to sri`), rebuild the
# trimmed workspace with `cargo build --locked -p statcraft_run`, and copy its
# Cargo.lock to lib/lockfiles/statcraft-<first 8 of rev>.Cargo.lock.
#
# Licence: MIT OR Apache-2.0 (upstream LICENSE-MIT, LICENSE-APACHE, NOTICE).

{ lib, pkgs }:

let
  version = "0.3.0";
  rev = "1d6902f76fe11fc873dc3b5b363115b70a93f756";

  src = pkgs.fetchFromGitHub {
    owner = "kobaltgit";
    repo  = "StatCraft";
    inherit rev;
    hash  = "sha256-DJ2oX8kr4Q8e0kHoCahs2irv1+x90HULnOqLIYqnnqw=";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "statcraft-run";
  inherit version src;

  cargoLock.lockFile = ./lockfiles/statcraft-${builtins.substring 0 8 rev}.Cargo.lock;

  # Trim the workspace to the engine crates and add the runner. Runs before
  # cargoSetupHook compares ./Cargo.lock with the vendored one.
  postPatch = ''
    cp ${./statcraft/workspace.Cargo.toml} Cargo.toml
    cp -r ${./statcraft/statcraft_run} crates/statcraft_run
    chmod -R u+w crates/statcraft_run
    cp ${./lockfiles/statcraft-${builtins.substring 0 8 rev}.Cargo.lock} Cargo.lock
  '';

  cargoBuildFlags = [ "-p" "statcraft_run" ];
  # The engine crates' own unit tests (descriptives, t-tests, syntax dispatch).
  cargoTestFlags  = [ "-p" "statcraft_core" "-p" "statcraft_algo" "-p" "statcraft_syntax" ];
  doCheck = true;

  postInstall = ''
    mkdir -p $out/share/doc/statcraft
    cp LICENSE-MIT LICENSE-APACHE NOTICE $out/share/doc/statcraft/
  '';

  meta = with lib; {
    description = "Headless runner for the StatCraft SPSS-compatible statistics engine";
    homepage    = "https://github.com/kobaltgit/StatCraft";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "statcraft-run";
  };
}
