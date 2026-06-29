# lib/nagual-qe.nix
#
# Nix derivation for proffesor-for-testing's Rust-native QE knowledge system.
# Repo: https://github.com/proffesor-for-testing/nagual-qe
#
# Nagual is the self-learning side of the QE pair (the active executor is
# agentic-qe). Until 2026-04-25 it was wired through `mkNpmCli` with
# `lib.fakeHash` because there is no published npm package — the project is
# Rust through-and-through, with Cargo.lock at the repo root and the binary
# entry-point at `src/main.rs` exposing a CLI named `nagual`.
#
# We build it from source via `buildRustPackage` (same pattern as
# lib/solid-pod-rs.nix) and provide a `nagual-qe` symlink alongside the
# canonical `nagual` binary so existing tooling (provision-agent-stacks.py,
# config/artifact-probes.json) keeps working without rename churn.
#
# Version-bump procedure:
#   1. Update `version` and `rev` below to a fresh upstream commit on master.
#   2. Set `srcHash` and `cargoHash` to lib.fakeHash, run `nix build .#runtime`.
#      Nix prints the real values via the hash-mismatch message; paste back.
#   3. ./scripts/prefetch-hashes.sh handles step 2 mechanically — see its
#      `--service nagual-qe` flag.
#
# Cargo features:
#   default = [ "kos", "onnx-embed" ]
#   tui     = [ "ratatui", "crossterm" ]
#   serve   = [ "axum", "tower", "tower-http", "futures-util" ]
#   full    = [ "tui", "serve" ]
#
# We ship the upstream defaults plus `serve` (HTTP API) because nagual is
# consumed by agentbox swarms as a sidecar. tui is excluded — interactive
# terminal mode is not part of the agentbox runtime contract.
#
# Licence: MIT (see upstream LICENSE). MIT is AGPL-3.0-compatible; no
# aggregation analysis needed for permissive components.

{ lib, pkgs }:

let
  version = "0.1.0";

  # Pinned to master at 2026-06-28 (commit b3f7a12 — deps bump).
  # Refresh via:
  #   gh api repos/proffesor-for-testing/nagual-qe/commits/master -q '.sha'
  rev = "b3f7a12609e3cb0a59e53bc6d6a82c08d46b0d05";

  # Resolve via:
  #   nix-prefetch-url --unpack --type sha256 \
  #     https://github.com/proffesor-for-testing/nagual-qe/archive/<rev>.tar.gz
  #   nix hash convert --hash-algo sha256 --to sri <base32>
  srcHash = "sha256-R3gZWOfP/iki+Nmzq2kDk8PADyJlDOFpiHZ9Sob2SXo=";

  # Resolved by buildRustPackage's vendoring on first build. Nix prints the
  # real hash on mismatch. Refresh via:
  #   nix build .#runtime
  #   (read the "got: sha256-…" line, paste here)
  cargoHash = "sha256-xYUeSYJyoQ/WIJiZHEXuliJ2NW8XuTl6VkgdEUjOzfs=";

  src = pkgs.fetchFromGitHub {
    owner = "proffesor-for-testing";
    repo  = "nagual-qe";
    inherit rev;
    hash  = srcHash;
  };

  # Default agentbox feature set: upstream defaults plus `serve`.
  # Operators can layer additional features through extraFeatures.
  defaultFeatures = [
    "kos"          # default
    "onnx-embed"   # default
    "serve"        # HTTP API surface
  ];

in

{
  # Build a nagual binary with the configured Cargo features.
  # Invoked from flake.nix when toolchains.nagual_qe = true.
  makeNagualQe = { extraFeatures ? [] }:
    pkgs.rustPlatform.buildRustPackage rec {
      pname   = "nagual-qe";
      inherit version src;

      # Vendoring: upstream commits Cargo.lock at repo root. cargoHash is
      # verified; the Nix sandbox permits network access inside a hash-checked FOD.
      # useFetchCargoVendor is the default since nixpkgs 25.05 — no need to set it.
      inherit cargoHash;

      buildNoDefaultFeatures = true;
      buildFeatures = defaultFeatures ++ extraFeatures;

      nativeBuildInputs = with pkgs; [
        pkg-config
        # ring + rusqlite-bundled-sqlcipher need a C/C++ toolchain.
        cmake
      ];

      buildInputs = with pkgs; [
        openssl
        # rusqlite uses bundled-sqlcipher → vendored libsqlcipher; provide
        # OS-side libs commonly required by ring + sqlcipher's build.rs.
        zlib
      ];

      # Tests require a postgres + writable sled; skip during Nix sandbox.
      # The agentbox-side smoke probe in config/artifact-probes.json (capability
      # "nagual-qe-cli", entrypoint @NIX_STORE_BIN@/nagual-qe --version) is the
      # readiness contract.
      doCheck = false;

      postInstall = ''
        # Stable `nagual-qe` alias next to the canonical `nagual` binary.
        # provision-agent-stacks.py and artifact-probes both reference this
        # name; preserve it across the npm→Rust transition.
        if [ -f $out/bin/nagual ]; then
          ln -sf nagual $out/bin/nagual-qe
        fi

        mkdir -p $out/share/doc/nagual-qe
        if [ -f $src/LICENSE ]; then
          cp $src/LICENSE $out/share/doc/nagual-qe/LICENSE
        fi
        if [ -f $src/README.md ]; then
          cp $src/README.md $out/share/doc/nagual-qe/README.md
        fi
      '';

      meta = with lib; {
        description = "Self-learning knowledge system for QE (Rust)";
        homepage    = "https://github.com/proffesor-for-testing/nagual-qe";
        license     = licenses.mit;
        mainProgram = "nagual";
        platforms   = platforms.linux;
      };
    };
}
