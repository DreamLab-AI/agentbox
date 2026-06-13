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
  # v0.4.0-alpha.16 (2026-06-09): the first real solid-pod-rs git tag since
  # alpha.11. It cuts an unambiguous version over what was previously the
  # untagged post-alpha.15 HEAD, killing the alpha.15 aliasing (the same version
  # string had denoted both the crates.io publish and an advanced git HEAD —
  # the Nix-store binary built from the publish predated the resource-cost
  # accounting fix and served cost-gated reads without consuming the cost; see
  # docs/developer/economy-loop.md "key discovery"). alpha.16 carries the
  # post-publish CORS allowlist, PSK admin provision endpoint, git control API,
  # /.well-known/apps aggregation, MCP docs embedding, the WAC ancestor
  # accessTo over-inheritance + git read-auth fix, and payments::debit wired
  # into the WAC grant path (R-04).
  # 0.5.0-alpha.0 (2026-06-13): the PROVENANCE release (solid-pod-rs ADR-059).
  # Adds block-trails (Bitcoin taproot-anchored, hash-chained provenance trails;
  # byte-parity with JSS token.js, verified against BIP-340/341 vectors),
  # git-marks (write-as-commit + PROV-O sidecar on every LDP write), the
  # ProvenanceLog composition (git-mark always / Bitcoin anchor opt-in / epoch
  # Merkle-root batching) + the `_prov` API + the ProvenanceAnchor WAC condition,
  # the now-routed web-ledger/order-book/AMM economy with replay protection wired
  # (PaymentStore the sole ledger I/O), and WAC-gated git smart-HTTP (the
  # anonymous clone/push hole closed). Full workspace: 1542 tests green.
  version = "0.5.0-alpha.0";

  # Pinned to the v0.5.0-alpha.0 tag commit.
  rev     = "9f33b505f10fb5a707cf5efdc53816b425750c10";

  # REFRESH REQUIRED for rev 9f33b50 (could not be computed in the editing
  # container — no `nix` binary). On a nix host, run `nix build .#runtime`: it
  # fetches the new src and fails with the correct expected `srcHash`, which you
  # paste here. Then refresh the vendored Cargo.lock per the procedure below.
  # The value left here is the previous (alpha.17) hash and WILL mismatch.
  srcHash = "sha256-pKpfZbHQ12Vjvtma0SgUl9zkg2/25R38SLYEwwvVOVY=";

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
