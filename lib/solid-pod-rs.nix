# lib/solid-pod-rs.nix
#
# Nix derivation for DreamLab-AI's Rust-native Solid Protocol 0.11 server.
# Repo: https://github.com/DreamLab-AI/solid-pod-rs
#
# ADR-010 promotes this to the first-class `pods` adapter implementation.
# Built from source via buildRustPackage — the crate is not yet in nixpkgs
# (tracked for upstream submission in the ADR-010 follow-ups).
#
# Version-bump procedure:
#   1. Update `version` and `rev` below.
#   2. Run: nix-prefetch-url --unpack https://github.com/DreamLab-AI/solid-pod-rs/archive/<rev>.tar.gz
#      Replace `srcHash` with the returned sha256 (or sri form).
#   3. Run: nix build .#runtime (or .#solid-pod-rs) — Nix will print the
#      cargoHash mismatch with the correct value. Paste it into `cargoHash`.
#
# Cargo features enabled by default:
#   - fs-backend      — POSIX filesystem with atomic-rename (ADR-010 invariant)
#   - nip98-schnorr   — BIP-340 Schnorr signature verification (matches our
#                       existing NostrBridge.verifyNip98 contract)
#   - security-primitives — SSRF guard + dotfile allowlist (hardened baseline)
#
# Deferred (available as manifest-driven Cargo-feature toggles):
#   - oidc             — Solid-OIDC 0.1 with DPoP
#   - dpop-replay-cache — JTI replay protection for DPoP (requires `oidc`)
#   - s3-backend       — AWS S3 / MinIO / R2 / B2 storage
#   - legacy-notifications — SolidOS-compatible WebSocket adapter
#
# Licence: AGPL-3.0-only. See docs/developer/licensing.md for the binary
# aggregation analysis under AGPL §5 — we ship this as a standalone
# supervisord program, never linked as a library into agentbox first-party
# code, so the agentbox image stays MPL-2.0.

{ lib, pkgs }:

let
  # Version label is "0.4.0-alpha.1+sprint-9" because upstream's tag has not
  # moved past v0.4.0-alpha.1 but main is 8 commits ahead through Sprint 9
  # (WAC 2.0 conditions, did:nostr, webhook signing, rate-limit, quota,
  # operator surface). See lib/solid-pod-rs.nix commit message in agentbox
  # for the Sprint 5-9 absorption rationale.
  version = "0.4.0-alpha.1+sprint-9";

  # Pinned to main at Sprint 9 consolidation (docs: 7f8bc89, P0 feat: 2275146).
  # Operators running their first build will be asked by Nix to resolve the
  # full 40-char SHA on prefetch — that is the definitive rev we lock at.
  # When upstream tags v0.5.0 this flips to a tag ref.
  rev     = "7f8bc89";

  # Prefetched 2026-04-24 against rev 7f8bc89.
  # Refresh via:
  #   nix-prefetch-url --unpack --type sha256 \
  #     https://github.com/DreamLab-AI/solid-pod-rs/archive/<new-rev>.tar.gz
  #   nix hash convert --hash-algo sha256 --to sri <base32>
  srcHash = "sha256-h8UOzgqTnrPkDSEfrpC+0bhNVCrYizNniVFGW6YAFPs=";

  # Cargo vendor hash — buildRustPackage's `cargoHash`. Will be surfaced
  # on first build if the default is wrong; paste the "got:" hash here.
  # Currently fakeHash because computing cargo vendor requires running
  # the full buildRustPackage once to resolve dependencies.
  cargoHash = lib.fakeHash;

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "solid-pod-rs";
    inherit rev;
    hash  = srcHash;
  };

  # Default feature set is broader after Sprint 5-9 absorption:
  # every feature below ships ON because it materially sharpens the sovereign
  # data stack's invariants (did-nostr), closes a P0 security gap (rate-limit,
  # quota, webhook-signing), or preserves upstream config compatibility
  # (jss-v04, acl-origin).
  defaultFeatures = [
    "fs-backend"           # atomic-rename filesystem storage (ADR-010 I01/I08)
    "nip98-schnorr"        # BIP-340 verification matches nostr-bridge.js
    "security-primitives"  # SSRF guard + dotfile allowlist (P0)
    "config-loader"        # JSS-compatible config precedence
    "acl-origin"           # origin enforcement for WAC
    "webhook-signing"      # RFC 9421 Ed25519 signing of outbound notifications
    "did-nostr"            # did:nostr resolver — closes the identity loop
    "rate-limit"           # sliding-window LRU abuse guard
    "quota"                # per-pod .quota.json sidecar storage limits
    "jss-v04"              # JavaScriptSolidServer v0.4 config/behaviour compat
  ];

in

{
  # Build a solid-pod-rs server binary with the configured Cargo features.
  # Invoked from flake.nix when adapters.pods == "local-solid-rs".
  makeSolidPodRs = { extraFeatures ? [] }:
    pkgs.rustPlatform.buildRustPackage rec {
      pname   = "solid-pod-rs-server";
      inherit version src cargoHash;

      # The server binary lives under solid-pod-rs-server in the workspace.
      buildAndTestSubdir = "solid-pod-rs-server";

      buildFeatures = defaultFeatures ++ extraFeatures;

      nativeBuildInputs = with pkgs; [
        pkg-config
      ];

      # The `oidc` and related features pull in openssl transitively; include
      # it unconditionally to avoid feature-gate-driven build breakage on
      # operators who flip features via the manifest.
      buildInputs = with pkgs; [
        openssl
      ];

      # Tests require a writable filesystem and network access for some
      # fixture setup; skip during Nix sandbox build. The contract-test
      # harness at tests/contract/pods.contract.spec.js covers the
      # surface we care about at the agentbox level.
      doCheck = false;

      # Preserve the AGPL-3.0-only LICENCE in the derivation output so the
      # container image's aggregation analysis has the upstream source-of-truth
      # pointer.
      postInstall = ''
        mkdir -p $out/share/doc/solid-pod-rs
        if [ -f $src/LICENSE ]; then
          cp $src/LICENSE $out/share/doc/solid-pod-rs/LICENSE
        elif [ -f $src/LICENCE ]; then
          cp $src/LICENCE $out/share/doc/solid-pod-rs/LICENCE
        fi
        if [ -f $src/README.md ]; then
          cp $src/README.md $out/share/doc/solid-pod-rs/README.md
        fi
      '';

      meta = with lib; {
        description = "Rust-native Solid Protocol 0.11 server (DreamLab-AI)";
        homepage    = "https://github.com/DreamLab-AI/solid-pod-rs";
        license     = licenses.agpl3Only;
        mainProgram = "solid-pod-rs-server";
        platforms   = platforms.linux;
      };
    };
}
