# lib/codex-binary.nix
#
# Nix derivation for OpenAI's Rust-native Codex CLI.
# Release: https://github.com/openai/codex/releases/tag/rust-v0.124.0
#
# Uses the official pre-built musl tarballs (statically-linked, portable)
# rather than buildRustPackage from source — faster, deterministic, and
# matches upstream's own release artefact integrity.
#
# Per-arch SHA256s are pinned below. To bump the version:
#   1. Update codexVersion.
#   2. For each supported platform, run:
#        curl -sL <release-url>/codex-<triple>.tar.gz | sha256sum
#   3. Replace the hex strings below.
#
# Supported targets: x86_64-linux, aarch64-linux (musl).
# darwin / windows are NOT supported — agentbox is Linux-container-only; users
# on other hosts pull the published multi-arch image from GHCR.

{ lib, pkgs }:

let
  codexVersion = "0.124.0";
  baseUrl = "https://github.com/openai/codex/releases/download/rust-v${codexVersion}";

  # Map agentbox's system string to OpenAI's release asset triple.
  # musl tarballs chosen for container portability — a single static binary
  # with no glibc dependency, so it runs in our nix2container image regardless
  # of what libc the base has.
  assets = {
    "x86_64-linux" = {
      name   = "codex-x86_64-unknown-linux-musl.tar.gz";
      sha256 = "70948cbaa8d7318e526da430fbbad1140cd7bd08ba78afb282392a11e7bcacf5";
    };
    "aarch64-linux" = {
      name   = "codex-aarch64-unknown-linux-musl.tar.gz";
      sha256 = "1301b1624c9ee89c41a501b77b95107a8dc3c8c285624d72edcda7921be6332e";
    };
  };

  assetFor = system:
    assets.${system} or (throw ''
      lib/codex-binary.nix: no Codex release asset for system "${system}".
      Supported: ${lib.concatStringsSep ", " (builtins.attrNames assets)}.
      For darwin/windows hosts, pull the published agentbox image from GHCR
      (which is always linux/amd64 or linux/arm64) rather than building
      natively.
    '');

in

{
  # Build a codex derivation for a given system string (e.g. "x86_64-linux").
  # Invoked from flake.nix when toolchainCfg.codex is enabled.
  makeCodex = system:
    let
      asset = assetFor system;
      tarball = pkgs.fetchurl {
        url    = "${baseUrl}/${asset.name}";
        sha256 = asset.sha256;
      };
    in
    pkgs.stdenv.mkDerivation {
      pname   = "codex";
      version = codexVersion;

      src = tarball;

      # Upstream tarballs don't have a wrapping directory — the binary is at
      # the archive root. unpackPhase is a no-op because stdenv handles it,
      # but we set sourceRoot to '.' to handle single-file tarballs uniformly.
      sourceRoot = ".";

      # No build required — pre-compiled binary.
      dontBuild = true;

      # Strip isn't needed (upstream already stripped).
      dontStrip = true;

      # Patchelf is optional on musl (no dynamic linker), but we skip to keep
      # the binary bit-identical to upstream.
      dontPatchELF = true;

      installPhase = ''
        runHook preInstall

        mkdir -p $out/bin
        # The tarball may contain 'codex', 'codex-<arch>', or a directory —
        # cover all common shapes.
        if [ -f codex ]; then
          install -Dm755 codex $out/bin/codex
        elif [ -f codex-x86_64-unknown-linux-musl ]; then
          install -Dm755 codex-x86_64-unknown-linux-musl $out/bin/codex
        elif [ -f codex-aarch64-unknown-linux-musl ]; then
          install -Dm755 codex-aarch64-unknown-linux-musl $out/bin/codex
        else
          # Fall back: find the first executable file and name it 'codex'
          first_exec=$(find . -maxdepth 1 -type f -executable | head -n 1)
          if [ -n "$first_exec" ]; then
            install -Dm755 "$first_exec" $out/bin/codex
          else
            echo "ERROR: no codex binary found in release tarball" >&2
            ls -la
            exit 1
          fi
        fi

        runHook postInstall
      '';

      meta = with lib; {
        description = "OpenAI's Rust-native Codex CLI (terminal agent for code)";
        homepage    = "https://github.com/openai/codex";
        license     = licenses.asl20;
        platforms   = builtins.attrNames assets;
        mainProgram = "codex";
      };
    };
}
