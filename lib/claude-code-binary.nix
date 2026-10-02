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
  # 2.1.285 (built 2026-09-29, published to the `stable` auto-update channel
  # at https://downloads.claude.ai/claude-code-releases/stable as of
  # 2026-10-01): current stable Claude Code release, bumped from 2.1.280.
  # Retains the function-hook surface introduced in 2.1.276
  # (`session.compact`, `command.register`, `$.http.fetch`) that the
  # factrail compaction plugin needs (ADR-2093). 2.1.257 had none of it.
  #
  # NOTE (bump review, 2026-10-01): 2.1.286 is already in the public
  # CHANGELOG.md but had NOT been promoted to the `stable` channel pointer at
  # bump time, and 2.1.285 itself was only ~2d7h past its build timestamp
  # (manifest buildDate 2026-09-29T01:45:50Z) — short of the renovate.json
  # 3-day cool-off this repo otherwise applies. Picked anyway because it is
  # the vendor's own current default-rollout target (not a bleeding-edge
  # tag), and both per-arch hashes below were verified byte-for-byte against
  # Anthropic's own published manifest.json checksums for this version
  # (https://downloads.claude.ai/claude-code-releases/2.1.285/manifest.json),
  # not just the downloaded bytes' self-reported digest. Regenerate
  # /plugin-types after this bump — the factrail plugin's generated types
  # need to be re-checked against 2.1.285's hook surface (factrail CI and its
  # `claude plugin test` run under 2.1.285).
  claudeCodeVersion = "2.1.285";

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
      sha256 = "sha256-M9rR7GFaLgjMeLSU8FwRDkmRbeLHnXjsh5nr9GsjPSk=";
    };
    "aarch64-linux" = {
      sha256 = "sha256-JPrHd0m+09kTZda2kVqkuCThQxjstrwXrbwZLwHJFz0=";
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
