# lib/npm-cli.nix
#
# Generic helper for packaging arbitrary npm global CLIs as Nix derivations.
#
# Usage:
#   makeNpmCli {
#     pkgName   = "ruvector";           # npm package name (may be scoped)
#     version   = "0.2.23";             # exact semver — no ^ or ~
#     sha256    = "sha256-…";           # nix hash of the .tgz from npm registry
#     bin       = "ruvector";           # binary name that ends up in $out/bin
#     extraEnv  = { CHROME_PATH = …; }; # optional env-var wrapper (default {})
#   }
#
# The derivation:
#   1. Fetches <pkgName>-<version>.tgz from registry.npmjs.org.
#   2. Unpacks it, runs `npm install --production --ignore-scripts` to
#      populate node_modules (so transitive deps are present).
#   3. Creates a thin bash wrapper at $out/bin/<bin> that sets any extraEnv
#      vars and exec's the real entry-point via `node`.
#
# For packages whose entry-point is a simple shebang script rather than a
# `node` invocation, the wrapper still works because `exec node <script>`
# re-interprets the shebang correctly.
#
# Hash derivation procedure (run once per version bump):
#   nix-prefetch-url https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz
#   # For scoped packages (@scope/name):
#   nix-prefetch-url https://registry.npmjs.org/@scope/name/-/name-<ver>.tgz
# Convert the resulting base32 string to SRI form with:
#   nix hash to-sri --type sha256 <base32>
# Or fetch the sri directly:
#   nix-prefetch-url --type sha256 <url> | xargs nix hash to-sri --type sha256
#
# fakeHash sentinel:
#   When sha256 = lib.fakeHash, the derivation throws at evaluation time with
#   a message listing the exact prefetch command. This prevents silent misbuilds.
#
# Version bump checklist:
#   1. Update version = "…" in flake.nix (the caller site).
#   2. Run the nix-prefetch-url command shown in the throw message.
#   3. Replace lib.fakeHash with the returned SRI hash.
#   4. Renovate custom-manager in renovate.json will detect the new version
#      string and open a PR for future bumps.

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
  makeNpmCli = { pkgName, version, sha256, bin, extraEnv ? {} }:
    let
      # Placeholder-detection. Returning a substituted SRI means the derivation
      # still EVALUATES cleanly — the hash mismatch fails at realisation time
      # with Nix's standard "expected vs got" message, and the preFetch hint
      # below points the operator at the resolver command. Eval-time throws
      # broke every flake consumer including nix flake check and nix eval.
      _placeholder  = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      isFakeHash    = sha256 == _placeholder || sha256 == lib.fakeHash;
      effectiveHash = if isFakeHash then _placeholder else sha256;

      fakeHashHint = ''
        echo "========================================" >&2
        echo "agentbox npm-cli: ${pkgName}@${version}" >&2
        echo "sha256 is still the placeholder. Compute the real hash:" >&2
        echo "  nix-prefetch-url ${registryUrl pkgName version}" >&2
        echo "Then convert to SRI form:" >&2
        echo "  nix hash to-sri --type sha256 <base32-output>" >&2
        echo "And replace the fakeHash in flake.nix." >&2
        echo "========================================" >&2
      '';

      tarball = pkgs.fetchurl {
        url    = registryUrl pkgName version;
        sha256 = effectiveHash;
      };

      # Safely derive a Nix pname from the package name (strip scope prefix).
      pname = lib.replaceStrings ["@" "/"] ["" "-"]
                (lib.removePrefix "@" pkgName);

      # Build the env-var preamble for the wrapper script.
      envPreamble = lib.concatStringsSep "\n"
        (lib.mapAttrsToList (k: v: "export ${k}=${lib.escapeShellArg v}") extraEnv);

    in
    pkgs.stdenv.mkDerivation {
      inherit pname version;

      # Operator hint emitted by fetchurl when the placeholder sha was used.
      preFetch = lib.optionalString isFakeHash fakeHashHint;

      src = tarball;

      nativeBuildInputs = [
        pkgs.nodejs_20
        pkgs.nodePackages.npm
        pkgs.cacert     # provides /etc/ssl/certs/ca-bundle.crt for npm TLS
      ];

      # npm places unpacked content in a "package/" subdirectory inside the tgz.
      # stdenv's default unpack handles .tgz, so we just need to cd into it.
      sourceRoot = "package";

      dontBuild = true;

      installPhase = ''
        runHook preInstall

        # Install production dependencies. --ignore-scripts prevents lifecycle
        # hooks (postinstall etc.) that could fire their own network calls.
        # --no-fund and --no-audit suppress unrelated registry queries.
        #
        # Nix sandbox defaults set HOME=/homeless-shelter (unwritable) and
        # ship no CA trust store; both are mandatory for npm install to
        # reach registry.npmjs.org. We point HOME at TMPDIR and export
        # SSL_CERT_FILE from the cacert nativeBuildInput.
        #
        # If the sandbox has network disabled entirely (agentbox's default
        # when builds run under `nix --option sandbox true`), this step
        # will fail — the failure is now loud (no `|| true`) so operators
        # see the real cause rather than silently shipping an empty
        # node_modules tree.
        export HOME="$TMPDIR"
        export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        export NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"
        # --legacy-peer-deps: npm 7+ strict peer-dep resolution rejects any
        # over-broad peerOptional declaration (e.g. @claude-flow/aidefence
        # declares peerOptional agentdb@">=2.0.0-alpha.1" but the root
        # ships a newer alpha). We want the npm 6 semantics — resolve peers
        # best-effort, don't fail on conflicts — for every CLI we package,
        # because we are not a dependency-graph validator, we are a
        # binary-packager.
        npm install \
          --production \
          --ignore-scripts \
          --legacy-peer-deps \
          --no-fund \
          --no-audit \
          --no-progress 1>&2

        # Install package tree under $out/lib/<pname>
        mkdir -p $out/lib/${pname}
        cp -r . $out/lib/${pname}/

        # Resolve the entry-point from package.json "bin" field.
        # We use node to parse it so we handle both string and object forms.
        # Empty-string literals are written via [].join() to sidestep Nix
        # indented-string quote-escape rules and the outer shell quoting
        # around node -e.
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
          # Fallback: look for bin/<bin> or index.js
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

      meta = {
        description = "npm CLI: ${pkgName} @ ${version}";
        mainProgram  = bin;
      };
    };
}
