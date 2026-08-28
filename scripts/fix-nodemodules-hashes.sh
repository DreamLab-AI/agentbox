#!/usr/bin/env bash
# One-shot corrected FOD resolver for mkNpmCli nodeModulesHash sites.
# Parses the *error* line of `nix build` (the prefetch-hashes.sh parser reads
# the last "building" line instead, which mis-attributes the mismatch — the
# 2026-08-27 wedge). Iterates until no hash mismatch remains.
set -uo pipefail
cd "$(dirname "$0")/.."
for i in $(seq 1 20); do
  full=$(nix build .#runtime --no-link 2>&1); rc=$?
  out=$(echo "$full" | grep -A2 'hash mismatch in fixed-output derivation' | head -3)
  if [ -z "$out" ]; then
    # No hash mismatch ≠ success: a non-hash failure also produces no match.
    if [ $rc -eq 0 ]; then echo "ALL-HASHES-RESOLVED"; exit 0; fi
    echo "NON-HASH-BUILD-FAILURE"; echo "$full" | tail -20; exit 1
  fi
  drv=$(echo "$out" | sed -n "s|.*derivation '/nix/store/[a-z0-9]*-\(.*\)\.drv'.*|\1|p")
  got=$(echo "$out" | sed -n 's|.*got: *\(sha256-[A-Za-z0-9+/=]*\).*|\1|p')
  echo "-- pass $i: drv=$drv got=$got"
  if [ -z "$drv" ] || [ -z "$got" ]; then echo "PARSE-FAILURE"; echo "$out"; exit 1; fi
  case "$drv" in
    *-with-deps-*)
      pkg="${drv%-with-deps-*}"
      python3 - "$pkg" "$got" <<'PYEOF'
import re, sys
pkg, got = sys.argv[1], sys.argv[2]
src = open("flake.nix").read()
# drv names flatten scoped packages: "@scope/name" → "scope-name". Try the
# literal name, then every scoped reconstruction of the flattened form.
candidates = [pkg] + ['@' + pkg[:i] + '/' + pkg[i+1:] for i, c in enumerate(pkg) if c == '-']
n = 0
for cand in candidates:
    # match fakeHash or a stale pinned value (unlocked npm resolution drifts,
    # so a rebuilt FOD can legitimately produce a new hash — nix's `got` is
    # the ground truth either way)
    pat = re.compile(r'(pkgName\s*=\s*"' + re.escape(cand) + r'";\s*\n(?:.*\n)*?\s*nodeModulesHash\s*=\s*)(?:lib\.fakeHash|"sha256-[A-Za-z0-9+/=]+");')
    src, n = pat.subn(r'\1"' + got + '";', src)
    if n: break
open("flake.nix","w").write(src)
sys.exit(0 if n else 2)
PYEOF
      [ $? -eq 0 ] && echo "   patched nodeModulesHash for $pkg" || { echo "NO-MATCHING-FAKEHASH for $pkg"; exit 1; } ;;
    *) echo "UNEXPECTED-FOD: $drv (not a -with-deps npm FOD) — stopping for manual review"; exit 1 ;;
  esac
done
echo "ITERATION-LIMIT"; exit 1
