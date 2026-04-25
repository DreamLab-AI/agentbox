# lib/npm-cli.nix
#
# Generic helper for packaging arbitrary npm global CLIs as Nix derivations.
#
# Usage:
#   makeNpmCli {
#     pkgName         = "ruvector";        # npm package name (may be scoped)
#     version         = "0.2.23";          # exact semver — no ^ or ~
#     sha256          = "sha256-…";        # nix hash of the .tgz from npm registry
#     nodeModulesHash = "sha256-…";        # nix hash of the resolved node_modules tree
#     bin             = "ruvector";        # binary name that ends up in $out/bin
#     extraEnv        = { CHROME_PATH=…; }; # optional env-var wrapper (default {})
#   }
#
# Two-stage construction (the FOD-node_modules pattern):
#
#   Stage 1 (FOD):  fetchurl pulls <pkgName>-<version>.tgz from registry.npmjs.org.
#                   sha256 verifies the tarball.
#
#   Stage 2 (FOD):  a separate fixed-output derivation runs `npm install
#                   --production --ignore-scripts --legacy-peer-deps` against
#                   the unpacked tarball. Because this derivation declares
#                   outputHash = nodeModulesHash, Nix permits network access
#                   inside the sandbox (FODs are hash-verified, so the sandbox
#                   no longer needs to enforce hermeticity at the network
#                   layer). The output is a tree under $out/lib/<pname>/
#                   containing both the package source and a fully populated
#                   node_modules/ directory.
#
#   Stage 3 (regular derivation): a thin mkDerivation copies the FOD output
#                   into $out and writes the bash wrapper at $out/bin/<bin>.
#                   No network needed here.
#
# Why two FODs and not one combined FOD:
#   The tarball is small and content-addressed by upstream; we want it
#   tracked separately so a version bump invalidates only stage 1+2, while
#   `extraEnv` changes only invalidate stage 3.
#
# Why we cannot do `npm install` in a regular derivation:
#   Nix's sandbox blocks network access for non-FOD builds. Pre-2026-04-25
#   the helper relied on `sandbox = false` working around it; that broke
#   reproducibility and silently failed for any operator with a default
#   nix.conf. The FOD approach is the canonical fix used by buildNpmPackage.
#
# Hash derivation procedure (run once per version bump):
#   1. nix-prefetch-url https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz
#      → set sha256 = <result-as-sri>
#   2. Set nodeModulesHash = lib.fakeHash, then run `nix build .#runtime`.
#      Nix will print:
#          hash mismatch in fixed-output derivation
#          specified: sha256-AAAAA…
#          got:       sha256-<real>
#      Paste <real> back into nodeModulesHash. Re-run.
#   3. The prefetch helper at scripts/prefetch-hashes.sh resolves both
#      hashes in one sweep — see its `--cli` flag.
#
# fakeHash sentinel:
#   When sha256 = lib.fakeHash, the derivation evaluates and prints a
#   prefetch hint to stderr at fetch time, then fails with a hash-mismatch
#   error pointing at the registry URL. nodeModulesHash uses the same
#   sentinel + prefetch helper.
#
# Version bump checklist:
#   1. Update version = "…" in flake.nix (the caller site).
#   2. Set both sha256 and nodeModulesHash to lib.fakeHash.
#   3. Run ./scripts/prefetch-hashes.sh (resolves both, patches in-place).
#   4. Renovate custom-manager in renovate.json detects the version bump
#      automatically.

{ lib, pkgs }:

let
  # Build the registry URL for a given (possibly scoped) package name + version.
  # npm's tarball naming convention for scoped packages:
  #   @scope/name  →  https://registry.npmjs.org/@scope/name/-/name-<ver>.tgz
  # (the tarball basename is always the un-scoped name)
  registryUrl = pkgName: version:
    let
      isScoped = lib.hasPrefix "@" pkgName;
      baseName  =
        if isScoped
        then lib.last (lib.splitString "/" pkgName)
        else pkgName;
      # URL-encode the leading "@" for scoped packages to satisfy fetchurl
      encodedPkgName =
        if isScoped
        then lib.replaceStrings ["@"] ["%40"] pkgName
        else pkgName;
    in
    "https://registry.npmjs.org/${encodedPkgName}/-/${baseName}-${version}.tgz";

in

{
  makeNpmCli = {
    pkgName,
    version,
    sha256,
    nodeModulesHash,
    bin,
    extraEnv ? {},
  }:
    let
      # Placeholder-detection. Returning a substituted SRI means the derivation
      # still EVALUATES cleanly — the hash mismatch fails at realisation time
      # with Nix's standard "expected vs got" message, and the preFetch hint
      # below points the operator at the resolver command. Eval-time throws
      # broke every flake consumer including nix flake check and nix eval.
      _placeholder    = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      isFakeTarball   = sha256          == _placeholder || sha256          == lib.fakeHash;
      isFakeNodeMods  = nodeModulesHash == _placeholder || nodeModulesHash == lib.fakeHash;
      effectiveTarHash    = if isFakeTarball  then _placeholder else sha256;
      effectiveModulesHash = if isFakeNodeMods then _placeholder else nodeModulesHash;

      tarFakeHashHint = ''
        echo "========================================" >&2
        echo "agentbox npm-cli: ${pkgName}@${version} (tarball)" >&2
        echo "sha256 is still the placeholder. Compute the real hash:" >&2
        echo "  nix-prefetch-url ${registryUrl pkgName version}" >&2
        echo "Then convert to SRI form:" >&2
        echo "  nix hash to-sri --type sha256 <base32-output>" >&2
        echo "Or run: ./scripts/prefetch-hashes.sh --cli" >&2
        echo "========================================" >&2
      '';

      tarball = pkgs.fetchurl {
        url    = registryUrl pkgName version;
        sha256 = effectiveTarHash;
      };

      # Safely derive a Nix pname from the package name (strip scope prefix).
      pname = lib.replaceStrings ["@" "/"] ["" "-"]
                (lib.removePrefix "@" pkgName);

      # Build the env-var preamble for the wrapper script.
      envPreamble = lib.concatStringsSep "\n"
        (lib.mapAttrsToList (k: v: "export ${k}=${lib.escapeShellArg v}") extraEnv);

      # ---- Stage 2: FOD that resolves node_modules. ------------------------
      # Network is permitted because outputHash is declared. The output is
      # the package directory with a populated node_modules/ subtree.
      packageWithDeps = pkgs.stdenv.mkDerivation {
        pname  = "${pname}-with-deps";
        inherit version;

        src = tarball;
        sourceRoot = "package";

        nativeBuildInputs = [
          pkgs.nodejs_20
          pkgs.nodePackages.npm
          pkgs.cacert
        ];

        dontBuild = true;
        dontFixup = true;

        # The FOD machinery requires a deterministic install. We pass the
        # same flags that buildNpmPackage uses, plus --legacy-peer-deps for
        # the same reason as before (overly-strict peerOptional decls in
        # the npm graph would otherwise break random installs).
        installPhase = ''
          runHook preInstall

          export HOME="$TMPDIR"
          export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          export NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"

          # Ensure deterministic timestamps inside node_modules so that
          # outputHashMode = "recursive" + content addressing yields a stable
          # hash. SOURCE_DATE_EPOCH defaults to 1 inside Nix builds.
          npm install \
            --production \
            --ignore-scripts \
            --legacy-peer-deps \
            --no-fund \
            --no-audit \
            --no-progress 1>&2

          mkdir -p $out
          cp -r . $out/

          runHook postInstall
        '';

        outputHashAlgo = "sha256";
        outputHashMode = "recursive";
        outputHash     = effectiveModulesHash;

        # Surface a hint at fetch-time when the placeholder hash is in use.
        # The `passthru` keeps the hint discoverable via `nix eval`.
        preFetch = lib.optionalString isFakeNodeMods ''
          echo "========================================" >&2
          echo "agentbox npm-cli: ${pkgName}@${version} (node_modules FOD)" >&2
          echo "nodeModulesHash is still the placeholder. The first build" >&2
          echo "will print the real hash via Nix's standard hash-mismatch" >&2
          echo "message. Run ./scripts/prefetch-hashes.sh --cli to" >&2
          echo "resolve every fakeHash in one sweep." >&2
          echo "========================================" >&2
        '';
      };

    in
    # ---- Stage 3: thin wrapper derivation; no network needed. ------------
    # We use packageWithDeps as our `src` so stdenv has something to unpack
    # (a no-op for directories — it copies into the build dir). This keeps
    # stdenv happy without forcing dontUnpack tricks.
    pkgs.stdenv.mkDerivation {
      inherit pname version;

      # Surface fakeHash hints from stage 1 here too.
      preFetch = lib.optionalString isFakeTarball tarFakeHashHint;

      src = packageWithDeps;
      dontBuild = true;

      installPhase = ''
        runHook preInstall

        # Install package tree under $out/lib/<pname>
        mkdir -p $out/lib/${pname}
        cp -r ./. $out/lib/${pname}/

        # Resolve the entry-point from package.json "bin" field.
        # We use node to parse it so we handle both string and object forms.
        # Empty-string literals are written via [].join() to sidestep Nix
        # indented-string quote-escape rules and the outer shell quoting
        # around node -e.
        cd $out/lib/${pname}
        entry=$(${pkgs.nodejs_20}/bin/node -e "
          const p = require('./package.json');
          const b = p.bin;
          const EMPTY = [].join();
          if (!b) { process.stdout.write(EMPTY); process.exit(0); }
          if (typeof b === 'string') { process.stdout.write(b); process.exit(0); }
          const key = ${lib.escapeShellArg (builtins.toJSON bin)};
          process.stdout.write(b[key] || Object.values(b)[0] || EMPTY);
        " 2>/dev/null || true)

        if [ -z "$entry" ]; then
          if [ -f "bin/${bin}" ]; then
            entry="bin/${bin}"
          elif [ -f "bin/${bin}.js" ]; then
            entry="bin/${bin}.js"
          elif [ -f "cli.js" ]; then
            entry="cli.js"
          else
            entry="index.js"
          fi
        fi

        mkdir -p $out/bin
        cat > $out/bin/${bin} <<WRAPPER
      #!/bin/sh
      ${envPreamble}
      exec ${pkgs.nodejs_20}/bin/node $out/lib/${pname}/$entry "\$@"
      WRAPPER
        chmod +x $out/bin/${bin}

        runHook postInstall
      '';

      passthru = {
        inherit packageWithDeps tarball;
      };

      meta = {
        description = "npm CLI: ${pkgName} @ ${version}";
        mainProgram  = bin;
      };
    };
}
