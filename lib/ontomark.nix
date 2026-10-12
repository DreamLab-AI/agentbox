# lib/ontomark.nix
#
# `ontomark` — the released shared-ontology CLI (DreamLab-AI/ontomark), baked
# beside `vault` as the first step of ADR-2136 (pin the shared toolchain) and
# the Agentbox half of Ontomark ADR-OM-005 (one producer).
#
# Why a release binary rather than a Rust build
# ----------------------------------------------
# Ontomark publishes a static musl binary per release with a sha256 beside it.
# Fetching that by digest is content-addressed exactly as a flake input is, and
# it is the same artefact visionGraph's publish pipeline and the Loom host run,
# so the agentbox cannot drift from the estate's producer by building its own.
# A Nix `buildRustPackage` would re-derive the binary from source and add the
# toolchain to the closure for no reproducibility gain.
#
# Division with `vault` (lib/vault.nix)
# -------------------------------------
# `ontomark` carries validate, gate, conflicts, build, repair and migrate. The
# governance verbs the ontology-augment skill still needs (find, retrieve, tree,
# edit, propose) are the deliberate ADR-OM-001 subset that stays in VisionClaw's
# `vault` until the typed-model port lands (Ontomark DEPRECATION §13, AB-P6).
# So both are baked; the skill routes each verb to the binary that owns it, and
# `vault` retires verb by verb, not in one cut.
#
# Repinning
# ---------
# Change `version`, `sha256` (from the release's .sha256 asset) and nothing else.
# The asset name keeps the `-linux-gnu` suffix the first release used; the
# binary itself is static-pie musl and runs on glibc and Nix hosts alike.

{ lib, pkgs, version ? "0.2.0"
, hash ? "sha256-b/PzkawNMvVl3LPDJ+1Zo6YqK+cHyOMBrq42XbMsgws=" }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "ontomark";
  inherit version;

  src = pkgs.fetchurl {
    url = "https://github.com/DreamLab-AI/ontomark/releases/download/v${version}/ontomark-x86_64-unknown-linux-gnu";
    inherit hash;
  };

  dontUnpack = true;
  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    install -Dm755 "$src" "$out/bin/ontomark"
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    "$out/bin/ontomark" --version | grep -qx "ontomark ${version}"
  '';

  meta = with lib; {
    description =
      "ontomark — the shared-ontology CLI: validate, gate, conflicts and the corpus build (public and machine scopes), released by DreamLab-AI/ontomark";
    homepage = "https://github.com/DreamLab-AI/ontomark";
    license = with licenses; [ mit asl20 ];
    mainProgram = "ontomark";
    platforms = [ "x86_64-linux" ];
  };
}
