# lib/antigravity-cli.nix
#
# Nix derivation for Google's Antigravity CLI (`agy`) — the terminal coding
# agent that replaced @google/gemini-cli (sunset 2026-06-18).
#
# IMPORTANT: this is NOT the nixpkgs `antigravity` package. That package is
# the Antigravity IDE (a VS Code fork, binary `bin/antigravity`) — a different
# product that happens to share the name. AoE's native `antigravity` agent
# execs `agy`, which upstream distributes only via install script from a
# manifest-driven release bucket.
#
# Release discovery (no stable "latest" URL — the manifest is the source of
# truth). To bump the version:
#   1. curl -fsSL https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json
#      curl -fsSL https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_arm64.json
#   2. Update agyVersion, the per-arch url and hash below (manifest sha512 hex
#      → SRI: python3 -c "import base64;print('sha512-'+base64.b64encode(bytes.fromhex('<hex>')).decode())").
#
# Runtime notes:
#   - The binary is glibc-dynamic (interpreter /lib64/ld-linux-*), which the
#     agentbox image provides; dontPatchELF keeps it bit-identical to the
#     manifest sha512.
#   - agy self-updates in the background when writable; from the nix store the
#     self-update fails harmlessly and the pin here stays authoritative.
#   - agy hard-codes ~/.gemini for logs/crash/oauth state (no env override —
#     GEMINI_CLI_HOME is ignored, verified 2026-08-05), so the image must
#     provide a writable /home/devuser/.gemini (tmpfs mount in flake.nix).

{ lib, pkgs }:

let
  agyVersion = "1.1.11";
  buildId = "4956531888881664";
  baseUrl = "https://storage.googleapis.com/antigravity-public/antigravity-cli/${agyVersion}-${buildId}";

  assets = {
    "x86_64-linux" = {
      url  = "${baseUrl}/linux-x64/cli_linux_x64.tar.gz";
      hash = "sha512-MtZFKc8DWrl5A1IGndDfRSXXySC0KHLeF3XmVFXnf9mDs3pt7oGmNFsGDJjV81Bym7XirogbvagPRrdIevRYjQ==";
    };
    "aarch64-linux" = {
      url  = "${baseUrl}/linux-arm/cli_linux_arm64.tar.gz";
      hash = "sha512-+xrKzb3mBqYKgAK23AqMmAC7hK7zrdBp+EP2/6Pvqv5KUvzkQFBcbxauvWsSV8zl7PrsLbqyFzLGJZQ0IjGM2w==";
    };
  };

  assetFor = system:
    assets.${system} or (throw ''
      lib/antigravity-cli.nix: no Antigravity CLI release asset for system "${system}".
      Supported: ${lib.concatStringsSep ", " (builtins.attrNames assets)}.
    '');

in

{
  # Build an agy derivation for a given system string (e.g. "x86_64-linux").
  # Invoked from flake.nix when toolchainCfg.antigravity_cli is enabled.
  makeAntigravityCli = system:
    let
      asset = assetFor system;
      tarball = pkgs.fetchurl { inherit (asset) url hash; };
    in
    pkgs.stdenv.mkDerivation {
      pname   = "antigravity-cli";
      version = agyVersion;

      src = tarball;

      # Tarball contains a single `antigravity` binary at the archive root;
      # the official installer renames it to `agy` on install — mirror that.
      sourceRoot = ".";
      dontBuild = true;
      dontStrip = true;
      dontPatchELF = true;

      installPhase = ''
        runHook preInstall

        if [ -f antigravity ]; then
          install -Dm755 antigravity $out/bin/agy
        else
          echo "ERROR: no antigravity binary found in release tarball" >&2
          ls -la
          exit 1
        fi

        runHook postInstall
      '';

      meta = with lib; {
        description = "Google Antigravity CLI (agy) — terminal coding agent, successor to gemini-cli";
        homepage    = "https://antigravity.google/cli";
        license     = licenses.unfree;
        platforms   = builtins.attrNames assets;
        mainProgram = "agy";
      };
    };
}
