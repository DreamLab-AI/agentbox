# lib/claude-code-binary.nix
#
# Nix derivation for Anthropic's Claude Code native CLI binary.
# Release: https://downloads.claude.ai/claude-code-releases/
#
# Uses the official pre-built binaries (statically-linked, portable)
# rather than npm install — faster, deterministic, and matches
# upstream's own release artefact integrity.
#
# Per-arch SHA256s are pinned below. To bump the version:
#   1. Update claudeCodeVersion.
#   2. For each supported platform, run:
#        nix-prefetch-url https://downloads.claude.ai/claude-code-releases/<ver>/<platform>/claude
#        nix hash to-sri --type sha256 <base32>
#   3. Replace the hex strings below.
#
# Supported targets: x86_64-linux, aarch64-linux.
# darwin / windows are NOT supported — agentbox is Linux-container-only; users
# on other hosts pull the published multi-arch image from GHCR.

{ lib, pkgs }:

let
  # 2.1.306 (bumped 2026-10-21; checksums from the published manifest).
  # Includes low-disk transcript preservation and headless Stop/subagent fixes.
  # Advisor tool (ADR-2134) needs >= 2.1.293 for Haiku 5.5 pairings.
  # 2.1.294 (bumped 2026-10-08).
  # 2.1.289 (built 2026-10-03T19:38:35Z; bumped 2026-10-05).
  # Driver: the ruflo 3.51.x mods (ruflo-console) need Claude Code 2.1.287+.
  # Retains the function-hook surface introduced in 2.1.276
  # (`session.compact`, `command.register`, `$.http.fetch`) that the
  # factrail compaction plugin needs (ADR-2093).
  #
  # This is Anthropic's latest channel release. Both per-arch hashes are
  # verified against its published manifest:
  # https://downloads.claude.ai/claude-code-releases/2.1.306/manifest.json
  #   linux-x64   520bc6c1f40af466bd03a278b5ae1af1a2938bc7de5b9e5cb15526da20d71cfe
  #   linux-arm64 77d257d5e8b8730ec61d5a4992a8eb65550aaf9589f464988aa1a9684338d801
  claudeCodeVersion = "2.1.306";

  # Map agentbox's system string to the upstream download platform slug.
  platforms = {
    "x86_64-linux"  = "linux-x64";
    "aarch64-linux" = "linux-arm64";
  };

  platformFor = system:
    platforms.${system} or (throw ''
      lib/claude-code-binary.nix: no Claude Code release asset for system "${system}".
      Supported: ${lib.concatStringsSep ", " (builtins.attrNames platforms)}.
      For darwin/windows hosts, pull the published agentbox image from GHCR
      (which is always linux/amd64 or linux/arm64) rather than building
      natively.
    '');

  # Per-arch SHA256 hashes of the upstream binary.
  # lib.fakeHash triggers a build-time error with the exact prefetch command.
  assets = {
    "x86_64-linux" = {
      sha256 = "sha256-UgvGwfQK9Ga9A6J4ta4a8aKTi8feW55csVUm2iDXHP4=";
    };
    "aarch64-linux" = {
      sha256 = "sha256-d9JX1ei4cw7GHVpJkqjrZVUKr5WJ9GSYiqGpaEM42AE=";
    };
  };

  assetFor = system:
    assets.${system} or { sha256 = lib.fakeHash; };

in

{
  # Build a claude-code derivation for a given system string (e.g. "x86_64-linux").
  # Invoked from flake.nix when toolchainCfg.claude_code is enabled.
  makeClaudeCode = system:
    let
      platform = platformFor system;
      asset = assetFor system;
      binary = pkgs.fetchurl {
        url    = "https://downloads.claude.ai/claude-code-releases/${claudeCodeVersion}/${platform}/claude";
        inherit (asset) sha256;
      };
    in
    pkgs.stdenv.mkDerivation {
      pname   = "claude-code";
      version = claudeCodeVersion;

      src = binary;

      # Single binary download, no archive to unpack.
      dontUnpack = true;

      # No build required — pre-compiled binary.
      dontBuild = true;

      # Strip isn't needed (upstream already stripped).
      dontStrip = true;

      # Patchelf is optional on musl (no dynamic linker), but we skip to keep
      # the binary bit-identical to upstream.
      dontPatchELF = true;

      nativeBuildInputs = [ pkgs.makeBinaryWrapper ];

      installPhase = ''
        runHook preInstall

        mkdir -p $out/bin
        install -Dm755 $src $out/bin/claude

        # Wrap to disable auto-updater (Nix manages versions) and inject
        # runtime utilities that Claude Code shells out to.
        wrapProgram $out/bin/claude \
          --set DISABLE_AUTOUPDATER 1 \
          --set DISABLE_INSTALLATION_CHECKS 1 \
          --prefix PATH : ${lib.makeBinPath [
            pkgs.procps
            pkgs.ripgrep
            pkgs.bubblewrap
            pkgs.socat
          ]}

        # Alias: claude-code -> claude (convenience for scripts that use
        # the package name rather than the binary name).
        ln -s claude $out/bin/claude-code

        runHook postInstall
      '';

      meta = with lib; {
        description = "Claude Code — Anthropic's AI coding assistant (native binary)";
        homepage    = "https://claude.ai";
        platforms   = builtins.attrNames platforms;
        mainProgram = "claude";
      };
    };
}
