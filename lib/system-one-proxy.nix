# lib/system-one-proxy.nix
#
# Nix derivation for `system-one-proxy` (ADR-2139): the loopback typed-decision
# proxy every System One consumer in the container calls. It forwards
# `POST /v1/systemone` to the backend named in /run/agentbox/system-one.json
# (written by `agentbox-manifest system-one-project` at boot and by
# `./agentbox.sh systemone backend <name>` for a live switch), owns the vendor
# keys and enforces the ADR-2094 §5 locality rule. Baked under
# [system_one].enabled; see the supervisor block in flake.nix.
#
# Built from the in-repo Sovereign System One workspace (crates/system-one), the
# same source as the façade and the eval rig, so the proxy and the façade can
# never disagree on the wire types. Pure-Rust closure: reqwest on rustls, no
# openssl, no pkg-config. The checked-in workspace Cargo.lock pins it.
#
# Baked, not built in the workspace, for the reason lib/factrail.nix gives: a
# workspace `cargo build` links against the image's glibc store path, which the
# next rebuild collects.
#
# Licence: Apache-2.0 (workspace licence).

{ lib, pkgs }:

let
  version = "0.1.0";

  # The workspace minus the local build cache. The workspace root IS the build
  # root; cargoBuildFlags selects the one binary.
  systemOneSrc = lib.cleanSourceWith {
    src    = ../crates/system-one;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "system-one-proxy";
  inherit version;
  src = systemOneSrc;

  cargoLock.lockFile = ../crates/system-one/Cargo.lock;

  cargoBuildFlags = [ "-p" "system-one-proxy" ];
  cargoTestFlags  = [ "-p" "system-one-proxy" ];
  # The proxy's tests bind ephemeral loopback ports for a stub upstream and
  # write under $TMPDIR; the sandbox allows both. HOME is unwritable there.
  doCheck = true;
  preCheck = ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
  '';

  meta = with lib; {
    description = "Loopback System One proxy: one typed-decision endpoint, switchable between vendors and local engines (ADR-2139)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = licenses.asl20;
    mainProgram = "system-one-proxy";
    platforms   = platforms.linux;
  };
}
