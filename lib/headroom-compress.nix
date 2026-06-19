# lib/headroom-compress.nix
#
# Nix derivation for the in-repo `headroom-napi` Rust N-API crate — a native
# Node.js addon that provides high-performance compression primitives for
# agentbox's memory and transport layers. The crate uses napi-rs to produce a
# .node shared library loadable via require() from JavaScript/TypeScript.
#
# The crate source lives entirely in-repo at crates/headroom-napi with no
# external sibling path-deps, so the build is straightforward — no workspace
# layout reassembly is needed (unlike nostr-pod-bridge).
#
# Licence: AGPL-3.0-only (consistent with agentbox's sovereign data stack).

{ lib, pkgs }:

let
  version = "0.1.0";

  # In-repo crate, minus the local build cache.
  crateSrc = lib.cleanSourceWith {
    src    = ../crates/headroom-napi;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "headroom-napi";
  inherit version;
  src = crateSrc;

  cargoLock.lockFile = ../crates/headroom-napi/Cargo.lock;

  nativeBuildInputs = [ pkgs.pkg-config pkgs.nodejs ];
  buildInputs = [ pkgs.openssl ];

  # napi-rs produces a .node shared library rather than a standard binary.
  # Install it to a well-known path so the JS wrapper can locate it.
  postInstall = ''
    mkdir -p $out/lib/headroom
    find target -name "*.node" -exec cp {} $out/lib/headroom/headroom_napi.node \;
  '';

  # Tests run separately in CI, not in the Nix sandbox.
  doCheck = false;

  meta = with lib; {
    description = "High-performance compression N-API addon for agentbox (Rust + napi-rs)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = licenses.agpl3Only;
    platforms   = platforms.linux;
  };
}
