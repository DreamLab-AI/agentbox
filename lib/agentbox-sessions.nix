# lib/agentbox-sessions.nix
#
# Nix derivation for `agentbox-sessions` — the session plane (ADR-2153): a
# tmux-backed daemon and CLI that reconciles [[interaction_plane.session_seeds]]
# and replaces Agent of Empires. One binary, `agentbox-sessions`.
#
# Modelled on lib/agentbox-ops.nix: a self-contained [workspace] crate whose
# dependencies are all on crates.io, pinned by the checked-in Cargo.lock, so
# there are no sibling path-deps and no cargoHash to compute.
#
# doCheck is off on purpose. The suite reads the repository's agentbox.toml,
# config/session-plane/launch.json and config/harness-wrappers, none of which
# are inside this crate's source tree, and its integration tests drive a real
# tmux server. It runs where the whole repository is present: `cargo test` in
# services/agentbox-sessions (CI: the sessions-tests job in
# .github/workflows/tui-tests.yml) and
# tests/cli/session-launch-contract.test.mjs, which compares this binary's
# resolution of every seed with the Node contract test.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src    = ../services/agentbox-sessions;
    filter = path: _type: baseNameOf (toString path) != "target";
  };
in
pkgs.rustPlatform.buildRustPackage {
  pname = "agentbox-sessions";
  inherit version src;

  cargoLock.lockFile = ../services/agentbox-sessions/Cargo.lock;

  # No native deps: rustix uses the linux_raw backend, nothing links openssl.
  doCheck = false;

  meta = with lib; {
    description = "Agentbox session plane — tmux-backed daemon and CLI that reconciles the manifest's session seeds (ADR-2153)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    platforms   = platforms.linux;
    mainProgram = "agentbox-sessions";
  };
}
