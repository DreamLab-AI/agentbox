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
# From 0.3.0 `ontomark` carries validate, gate, conflicts, build, repair,
# migrate AND the corpus verbs find, retrieve, tree, edit, create and apply,
# ported from VisionClaw's `vault` byte-for-byte (Ontomark ADR-OM-007). `vault`
# keeps only `propose` and its Nostr transport, so both stay baked and the
# ontology-augment skill routes every read verb to `ontomark`, falling back to
# `vault` only on an image built before this pin. 0.3.0 reads the flat
# visionGraph vaults (pages at the vault root); 0.2.x cannot. 0.4.0 also runs
# on any plain Obsidian vault (Ontomark ADR-OM-008) and is `cargo install ontomark`.
# 0.5.0 adds the estate's Supply Chains and Logistics domain (domain 8,
# categories 53-67; visionGraph ADR-VG-008); older pins report its pages as
# uncategorised.
#
# Repinning
# ---------
# Change `version`, `sha256` (from the release's .sha256 asset) and nothing else.
# The asset name keeps the `-linux-gnu` suffix the first release used; the
# binary itself is static-pie musl and runs on glibc and Nix hosts alike.

{ lib, pkgs, version ? "0.5.0"
, hash ? "sha256-4PY/zqgd+ij2gmuyoXq8iBOkZkPCsUXbAtA/UQW1pBM=" }:

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
