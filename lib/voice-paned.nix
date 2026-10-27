# lib/voice-paned.nix
#
# Nix derivation for `voice-paned`, the container half of voicelink
# (ADR-2151; DreamLab-AI/agentbox-voicelink, crate crates/voice-paned). It is a
# per-connection process, NOT a supervisor program: the operator's client runs
#   ssh -T host docker exec -i --user 1000 agentbox \
#       /opt/agentbox/bin/voice-paned --stdio --session agentbox
# and the hooks registered by [voicelink].record_events call
#   voice-paned record --source claude|codex
# to append to ~/.local/state/voicelink/events.jsonl. Gate: [voicelink].enabled
# (REBUILD-class), see flake.nix.
#
# Why baked and not run from a workspace checkout: a `cargo build` inside the
# container links against the image's glibc store path, which the next rebuild
# garbage-collects (the lib/sidestr-agent.nix reasoning).
#
# agentbox-voicelink is a self-contained [workspace] with every dependency on
# crates.io (no git sources), so the vendored lockfile needs no outputHashes.
# The workspace also holds a client crate that depends on cpal/alsa-sys; it is
# never built here: every cargo invocation is `-p voice-paned`.
#
# Bump procedure (also the first-pin procedure):
#   1. Move `rev` to a pushed agentbox-voicelink commit.
#   2. Refresh `hash`: nix-prefetch-url --unpack
#      https://github.com/DreamLab-AI/agentbox-voicelink/archive/<rev>.tar.gz
#      then `nix hash convert --hash-algo sha256 --to sri <base32>`.
#   3. Copy that commit's Cargo.lock to
#      lib/lockfiles/agentbox-voicelink-<first 8 of rev>.Cargo.lock
#      (byte-identical; the filename below derives from `rev`).
#   4. Set `version` to the crate's version at that commit.
#   5. Rebuild on the host with [voicelink].enabled = true (agentbox.toml).
#
# Licence: Apache-2.0 OR MIT (the voicelink repository). The wire contract is
# the published `voicelink-proto` crate; this derivation pins the binary only.

{ lib, pkgs }:

let
  version = "0.1.0";

  rev = "dd557e6762cfbc195cc9a0d3afefb732224b0c0f";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "agentbox-voicelink";
    inherit rev;
    hash  = "sha256-o1toK75HgOW+DU4te927UvSNZxMQO/b/BxW/lV/LOFY=";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "voice-paned";
  inherit version src;

  # The commit's lockfile, vendored so evaluation never reads from the fetched
  # tree (no import-from-derivation). Byte-identical to Cargo.lock at `rev`.
  cargoLock.lockFile = ./lockfiles/agentbox-voicelink-${builtins.substring 0 8 rev}.Cargo.lock;

  # voice-paned only: the client crate links cpal/alsa-sys and is not wanted.
  cargoBuildFlags = [ "-p" "voice-paned" ];
  cargoTestFlags  = [ "-p" "voice-paned" ];

  # voice-paned's integration tests drive a real tmux server (control mode and
  # grouped sessions), so tmux must be on PATH during checkPhase. The tests stay
  # on: they are the only proof the focus-following contract holds against the
  # tmux this image ships.
  # The tests also call bash and util-linux `script` (a pty for the fake agent
  # panes); HOME is unwritable in the sandbox, so point it and tmux at TMPDIR.
  nativeCheckInputs = [ pkgs.tmux pkgs.bash pkgs.util-linux ];
  preCheck = ''
    export HOME=$TMPDIR TMUX_TMPDIR=$TMPDIR
  '';
  doCheck = true;

  meta = with lib; {
    description = "Container half of voicelink: tmux control-mode pane driver and hook-event recorder for client-side voice";
    homepage    = "https://github.com/DreamLab-AI/agentbox-voicelink";
    license     = with licenses; [ asl20 mit ];
    mainProgram = "voice-paned";
    platforms   = platforms.linux;
  };
}
