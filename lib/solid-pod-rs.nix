# lib/solid-pod-rs.nix
#
# Nix derivation for DreamLab-AI's Rust-native Solid Protocol 0.11 server.
# Repo: https://github.com/DreamLab-AI/solid-pod-rs
#
# ADR-010 promotes this to the first-class `pods` adapter implementation.
# Built from source via buildRustPackage — the crate is not yet in nixpkgs
# (tracked for upstream submission in the ADR-010 follow-ups).
#
# Version-bump procedure: see the "Refresh procedure" comment on the pin
# below (version + rev + SRI srcHash + vendored Cargo.lock; no cargoHash).
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

  # Pin: solid-pod-rs v0.5.0-alpha.9 (2026-09-06), the tagged release cut from
  # the estate closeout. It carries the OIDC compatibility matrix, WAC policy
  # outcomes, provenance receipts, the chacha20 unyank and deterministic
  # rate-limit tests, and re-aligns the crates.io set (every sibling crate is
  # published at the same version again). This is the same snapshot that the
  # `nostr-pod-bridge` path dependencies compile against, so the Nix-built
  # server binary and any cargo build of the bridge share one upstream.
  #
  # Refresh procedure when the rev bumps (no local nix needed):
  #   1. Set `version` and `rev` to the new tag and its commit.
  #   2. srcHash: docker run --rm nixos/nix sh -c \
  #        'h=$(nix-prefetch-url --unpack \
  #           https://github.com/DreamLab-AI/solid-pod-rs/archive/<rev>.tar.gz) && \
  #         nix --extra-experimental-features nix-command hash convert \
  #           --hash-algo sha256 --to sri "$h"'
  #   3. Lockfile: `git -C ../solid-pod-rs show <tag>:Cargo.lock > lib/solid-pod-rs.cargo-lock`
  #      (upstream ships its Cargo.lock since 0.5.0; the vendored copy keeps the
  #      Nix build hermetic and byte-identical to the tag).
  version = "0.5.0-alpha.9";

  # Pinned to the v0.5.0-alpha.9 tag commit.
  rev     = "1d9da527076e733d6a5571f474a573c16e5a6047";

  srcHash = "sha256-0/iDL8E9J5SGFnnJQwR3wP/qAjl9AHiKyKxU1U6qRfc=";

  cargoLockFile = ./solid-pod-rs.cargo-lock;

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "solid-pod-rs";
    inherit rev;
    hash  = srcHash;
  };

  # Baseline feature set shared by every agentbox build. Product features are
  # selected from agentbox.toml in flake.nix and passed as extraFeatures, so a
  # false manifest flag no longer leaves the feature silently compiled in.
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
    "git"               # git control API (/_git/* routes) + /.well-known/apps
    # ── Library-crate features via solid-pod-rs/<feature> ────────────
    "solid-pod-rs/config-loader"
    "solid-pod-rs/acl-origin"
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
      #
      # The `substituteInPlace` below fixes a live bug found 2026-08-14
      # (agentbox pod-provisioning investigation): `git_mark_write()` in
      # crates/solid-pod-rs-server/src/lib.rs derives the pod id from the
      # FIRST path segment of the write's resource path, assuming LDP
      # resources are served at `/{pod}/...`. In this deployment (and per
      # `handle_admin_provision`'s own doc comment, "pod container:
      # data_root/pods/{pk}/") they are actually served at
      # `/pods/{pod}/...`, so the extracted "pod id" is always the literal
      # string "pods", `data_root/pods` has no `.git`, and the git-backed
      # check silently skips EVERY write — no commit, no `.prov.ttl`
      # sidecar, ever, regardless of the `git` feature or a correctly
      # git-init'd pod. Reproduced live: a real NIP-98-authenticated PUT to
      # a pod with a valid `.git` and valid WAC grant returned 201 Created
      # but added zero commits. Fix: strip an optional leading `pods/`
      # segment before reading the pod id (a no-op, so backward compatible,
      # for any future/alternate deployment that serves pods at the
      # top-level `/{pod}/...` instead). `--replace-fail` aborts the build
      # loudly if upstream ever changes this line, rather than silently
      # shipping the unfixed binary.
      postPatch = ''
        chmod -R u+w .
        cp ${cargoLockFile} Cargo.lock
        chmod u+w Cargo.lock
        substituteInPlace crates/solid-pod-rs-server/src/lib.rs \
          --replace-fail \
            "let trimmed = resource_path.trim_start_matches('/');" \
            "let trimmed = resource_path.trim_start_matches('/');
    let trimmed = trimmed.strip_prefix(\"pods/\").unwrap_or(trimmed); // agentbox fix 2026-08-14: LDP writes are served at /pods/{pod}/..., not /{pod}/... — see docs/archive/dream-machine-capability-investigation.md"
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
