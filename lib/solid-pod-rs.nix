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
#   - mashlib          — SolidOS data-browser rendering for RDF resources
#                        (available from 0.4.0-alpha.5; enable via config)
#
# Licence: AGPL-3.0-only, consistent with agentbox (AGPL-3.0).
# Shipped as a standalone supervisord program, never linked as a library.
# See docs/developer/licensing.md for the component license matrix.

{ lib, pkgs }:

let
  # alpha.15 (2026-05-17): CORS allowlist (--allowed-origins / SOLID_ALLOWED_ORIGINS),
  # PSK admin provision endpoint (POST /_admin/provision/{pubkey}, --admin-key /
  # SOLID_ADMIN_KEY), git control API (9 /_git/* REST routes), /.well-known/apps
  # aggregation (JSS #464). Native pod mesh tier for dreamlab-ai.com.
  version = "0.4.0-alpha.15";

  # Pinned to v0.4.0-alpha.15 tag (0c5fa42).
  rev     = "0c5fa42";

  # Run to refresh after rev bump:
  #   nix-prefetch-url --unpack --type sha256 \
  #     https://github.com/DreamLab-AI/solid-pod-rs/archive/0c5fa42.tar.gz
  #   nix hash convert --hash-algo sha256 --to sri <base32>
  srcHash = "sha256-Gi54tlp62ipHjzQeOSEmo15UN99ZvuJz3+LEjcMdmu0=";

  # Upstream solid-pod-rs at v0.4.0-alpha.5 does not ship its
  # Cargo.lock (workspace builds without it locally because cargo
  # generate-lockfile picks the latest compat versions on first run, but
  # that is non-deterministic and breaks Nix's hermetic build). We vendor
  # a lockfile alongside lib/solid-pod-rs.nix instead.
  #
  # NOTE: cargoLockFile needs refresh for 0.4.0-alpha.5.
  # Refresh procedure when the rev bumps:
  #   1. Update version + rev above and re-run `nix build .#runtime`
  #      to fetch the new src.
  #   2. cd $(nix eval --raw nixpkgs#hello.src) → no, easier:
  #        nix-shell -p cargo --run 'cd $(mktemp -d) && \
  #          cp -r /nix/store/*-solid-pod-rs-*-source/. . && \
  #          chmod -R u+w . && cargo generate-lockfile'
  #      then copy the resulting Cargo.lock to lib/solid-pod-rs.cargo-lock.
  cargoLockFile = ./solid-pod-rs.cargo-lock;

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "solid-pod-rs";
    inherit rev;
    hash  = srcHash;
  };

  # Default feature set after Sprint 5-9 absorption: every feature below
  # ships ON because it sharpens the sovereign data stack (did-nostr),
  # closes a P0 hardening gap (rate-limit, quota, webhook-signing), or
  # preserves upstream config compatibility (config-loader, acl-origin).
  #
  # solid-pod-rs is a workspace where most of the protocol surface lives
  # on the LIBRARY crate (`solid-pod-rs`). The server crate
  # (`solid-pod-rs-server`) only forwards five feature names:
  #   security-primitives, did-nostr, rate-limit, quota, tls.
  # Library features that the server doesn't re-export must be enabled
  # via cargo's `<workspace-member>/<feature>` syntax. fs-backend +
  # memory-backend are part of the library's default feature set and
  # come in automatically when the server depends on the library.
  defaultFeatures = [
    # ── Server-crate features (forwarded pass-throughs) ──────────────
    "security-primitives"
    "did-nostr"
    "rate-limit"
    "quota"
    "git"               # git control API (/_git/* routes) + /.well-known/apps
    # ── Library-crate features via solid-pod-rs/<feature> ────────────
    "solid-pod-rs/nip98-schnorr"
    "solid-pod-rs/config-loader"
    "solid-pod-rs/acl-origin"
    "solid-pod-rs/webhook-signing"
    "solid-pod-rs/jss-v04"
  ];

in

{
  # Build a solid-pod-rs server binary with the configured Cargo features.
  # Invoked from flake.nix when adapters.pods == "local-solid-rs".
  makeSolidPodRs = { extraFeatures ? [] }:
    pkgs.rustPlatform.buildRustPackage rec {
      pname   = "solid-pod-rs-server";
      inherit version src;

      # Vendored lockfile (upstream omits Cargo.lock).
      cargoLock.lockFile = cargoLockFile;

      # Copy the vendored lockfile into the source tree before configurePhase
      # so cargo can find it relative to the workspace root.
      postPatch = ''
        cp ${cargoLockFile} Cargo.lock
      '';

      # The workspace member lives under crates/solid-pod-rs-server.
      buildAndTestSubdir = "crates/solid-pod-rs-server";

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
