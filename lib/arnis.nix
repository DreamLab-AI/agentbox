# lib/arnis.nix
#
# Nix derivation for `arnis` (louis-e/arnis, Apache-2.0), the Rust CLI that turns
# OpenStreetMap data into Minecraft worlds. It is the engine of the `terracraft`
# skill (skills/terracraft), which until now expected a hand-built
# /usr/local/bin/arnis. Baked here for the same reason as lib/sidestr-agent.nix:
# a binary `cargo build`-ed inside the container links an image glibc store path
# that the next rebuild garbage-collects.
#
# UNBUILT until the next image build: written and hashed without a Nix
# evaluator (scripts/nar-hash.py), reviewed by reading only. Expect a first-build
# correction (most likely a missing native input).
#
# Pinned: v3.4.0, commit 6f193e37bda9bf826547fec5b4f5dc6e61d34247.
#
# CLI only: `buildNoDefaultFeatures` drops the default `gui` feature (tauri, rfd,
# tokio); src/main.rs carries a no-op `progress` stand-in for that build.
# rusqlite, zstd-sys and libmimalloc-sys compile bundled C; TLS is rustls via
# aws-lc-sys (cc + cmake), so no openssl. rustls-native-certs reads the system
# CA bundle at run time (SSL_CERT_FILE / /etc/ssl/certs).
#
# Lockfile: vendored at lib/lockfiles/arnis-<short rev>.Cargo.lock (byte-identical
# to Cargo.lock at `rev`), because reading "${src}/Cargo.lock" is
# import-from-derivation, which `nix flake check --no-build` cannot realise
# (see lib/rune.nix). The git dependencies below still need outputHashes; every
# crate in one repository shares that repository's hash.
#
# To bump:
#   1. Move `version`/`rev` to the new release commit (GitHub API
#      /repos/louis-e/arnis/commits/<tag>, the commit sha, not the tag object).
#   2. scripts/nar-hash.py https://codeload.github.com/louis-e/arnis/tar.gz/<rev>
#      -> `hash`.
#   3. Copy that commit's Cargo.lock to lib/lockfiles/arnis-<short rev>.Cargo.lock
#      and update the path below.
#   4. For each `git+` source in the lock (grep 'source = "git+' Cargo.lock) run
#      scripts/nar-hash.py https://codeload.github.com/<owner>/<repo>/tar.gz/<full rev>
#      and update outputHashes ("<crate>-<version>" keys). Check the repository
#      has no .gitattributes export-ignore/export-subst and no submodules: codeload
#      honours them, a git checkout does not.
#
# Licence: Apache-2.0 (Cargo.toml and LICENSE).

{ lib, pkgs, rustPlatform ? pkgs.rustPlatform }:

let
  version = "3.4.0";
  rev = "6f193e37bda9bf826547fec5b4f5dc6e61d34247";

  src = pkgs.fetchFromGitHub {
    owner = "louis-e";
    repo  = "arnis";
    inherit rev;
    hash  = "sha256-oD61x47w1s8fzFYyzA7/NbIR0J7TXDiPnO71JjuQjF4=";
  };

  bedrockHash = "sha256-0HP6p2x6sulZ2u8FzEfAiNAeyaUjQQWgGyK/kPo0PuQ=";

in
rustPlatform.buildRustPackage {
  pname = "arnis";
  inherit version src;

  buildNoDefaultFeatures = true;

  cargoLock = {
    lockFile = ./lockfiles/arnis-${builtins.substring 0 8 rev}.Cargo.lock;
    outputHashes = {
      # MIERUNE/dda-voxelize-rs @ 1e0844a8
      "dda-voxelize-0.2.0-alpha.1" = "sha256-MiSvqlzvezp7TXIDZl7+/x+zCPcsbFo2hhMWBJKqvaE=";
      # bedrock-crustaceans/bedrock-rs @ 7ef268b0 (one repository, five crates)
      "bedrockrs_core-0.1.0"       = bedrockHash;
      "bedrockrs_level-0.1.0"      = bedrockHash;
      "bedrockrs_macros-0.1.0"     = bedrockHash;
      "bedrockrs_proto_core-0.1.0" = bedrockHash;
      "bedrockrs_shared-0.1.0"     = bedrockHash;
      # louis-e/nbtx @ 551c38ac (the [patch] pin of bedrock-crustaceans/nbtx)
      "nbtx-0.1.0"                 = "sha256-JoNSL1vrUbxX6hKWB4i/DX02+hsQemANJhQaEELlT2o=";
    };
  };

  nativeBuildInputs = [ pkgs.pkg-config pkgs.cmake pkgs.perl ];
  # cmake is only for aws-lc-sys's build script, not a project to configure.
  dontUseCmakeConfigure = true;

  # Tests exercise the bundled map data and some need the network.
  doCheck = false;

  meta = with lib; {
    description = "Generates Minecraft worlds from OpenStreetMap data (CLI build, no GUI); the terracraft skill's engine";
    homepage    = "https://github.com/louis-e/arnis";
    license     = licenses.asl20;
    mainProgram = "arnis";
    platforms   = platforms.linux;
  };
}
