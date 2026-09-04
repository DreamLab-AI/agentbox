# lib/agentbox-manifest.nix
#
# Nix derivation for `agentbox-manifest` — the boot-time TOML/JSON projector.
#
# Before this crate, python3 was a *boot* dependency of agentbox: not because
# anything at boot needed an interpreter, but because
# config/entrypoint-unified.sh reached for `tomllib` and `json` seventeen times
# to munge .mcp.json, project [interaction_plane.proxy], parse the plugin list
# and probe embedding dimensions, and four sibling scripts did the same work at
# greater length. This binary is every one of those sites, as clap subcommands
# with byte-identical outputs (tests/golden* pins that against fixtures captured
# from the Python itself).
#
# UNGATED, deliberately. Every other optional feature in this repo rides an
# `agentbox.toml` gate, but the entrypoint cannot boot without this binary, so
# there is no meaningful "off" state to gate — the same reason nothing gates
# bash or coreutils. Adding a gate would let an operator produce an image that
# cannot start.
#
# python3 itself STAYS in the image and is untouched: opf-router (torch) and the
# code-interpreter MCP server (Jupyter kernels) are genuinely Python-hosted and
# remain supervised. What changes is that boot no longer needs an interpreter to
# read its own configuration.
#
# Modelled on lib/dream-engine.nix, and simpler still: the crate is a
# self-contained [workspace] whose whole dependency closure (clap, serde,
# serde_json, toml, regex) is pure Rust from crates.io — no reqwest, so no TLS
# backend, no openssl, no pkg-config probe, and no sibling path-deps to
# reassemble. The checked-in Cargo.lock pins the closure.
#
# Tests are hermetic: they read fixtures from the source tree, write to temp
# directories, and touch neither the network nor a database, so doCheck runs
# them in the sandbox. The one suite that would need Node
# (agentbox-config-validate.js, for schema compatibility) detects its absence
# and skips rather than failing. Bash runs the isolated boot projection test.
#
# Licence: MIT OR Apache-2.0 (the crate and its whole closure are permissive).

{ lib, pkgs }:

let
  version = "0.1.0";

  # In-repo crate, minus the local build cache. The crate root IS the build root.
  agentboxManifestSrc = lib.cleanSourceWith {
    src    = ../services/agentbox-manifest;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

  tuiFixturesSrc = lib.cleanSource ../tests/tui/fixtures;

in
pkgs.rustPlatform.buildRustPackage {
  pname = "agentbox-manifest";
  inherit version;
  src = agentboxManifestSrc;

  # Standalone [workspace]; the checked-in lockfile pins the full closure.
  cargoLock.lockFile = ../services/agentbox-manifest/Cargo.lock;

  # The parity suites consume the repository-level wizard fixtures. Stage the
  # canonical files inside the isolated crate source and adjust only the Nix
  # build copy's relative lookups.
  postPatch = ''
    mkdir -p tests/tui/fixtures
    cp -R ${tuiFixturesSrc}/. tests/tui/fixtures/
    cp ${../config/entrypoint-unified.sh} tests/entrypoint-unified.sh
    substituteInPlace tests/consultant_model.rs \
      --replace-fail '../../../config/entrypoint-unified.sh' 'entrypoint-unified.sh'
    substituteInPlace tests/golden.rs \
      --replace-fail '../../tests/tui/fixtures' 'tests/tui/fixtures'
    substituteInPlace tests/tui_helpers.rs \
      --replace-fail '.join("../..")' '.join(".")'
  '';

  doCheck = true;
  nativeCheckInputs = [ pkgs.bash ];

  meta = with lib; {
    description = "Boot-time TOML/JSON projection for agentbox — replaces the inline python3 in the entrypoint and the four manifest scripts (.mcp.json upserts, ADR-069 proxy config, ADR-041 model routing, profile provisioning, TUI manifest round-trip)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "agentbox-manifest";
    platforms   = platforms.linux;
  };
}
