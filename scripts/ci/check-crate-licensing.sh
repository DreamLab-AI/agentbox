#!/bin/sh
# check-crate-licensing.sh — Invariant (ADR-2030): every package directory under
# services/ carries, on disk and next to its manifest, exactly the licence texts
# and the README statement its Cargo.toml declares.
#
# ADR-2030 makes services/ a permissive subtree (MIT OR Apache-2.0) inside an
# AGPL-3.0-only repository, with one documented exception: a crate that links an
# AGPL library declares AGPL-3.0-only instead. That split is only real if the
# texts travel with the crate — a crates.io tarball carries the crate directory,
# not the repository root LICENSE. A declared grant with no adjacent text is a
# promise the published artefact cannot keep, which is exactly the gap the
# 2026-09-04 closeout recorded.
#
# Rules enforced per services/<crate>/Cargo.toml:
#   1. [package] declares license, description, repository and readme.
#   2. license = "MIT OR Apache-2.0"  -> LICENSE-MIT and LICENSE-APACHE exist,
#      hold the corresponding standard texts, and README.md carries the dual
#      grant plus the contribution paragraph.
#   3. license = "AGPL-3.0-only"      -> LICENSE exists and holds the AGPL-3.0
#      text, README.md says AGPL and says it is NOT dual-licensed, and no
#      permissive text is present to be mistaken for a grant.
#   4. Any other licence expression is unrecognised and fails, so a new grant is
#      a deliberate change to this gate rather than an unchecked string.
#
# Exit: 0 = every package directory matches its declaration, 1 = otherwise.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FAILURES=0
CHECKED=0

fail() {
  echo "FAIL (check-crate-licensing): $1" >&2
  FAILURES=$((FAILURES + 1))
}

# package_field <manifest> <key> — value of <key> inside the [package] table.
package_field() {
  awk -v key="$2" '
    /^\[/ { in_pkg = ($0 ~ /^\[package\]/) ? 1 : 0; next }
    in_pkg && $0 ~ "^" key "[ \t]*=" {
      sub("^" key "[ \t]*=[ \t]*", "")
      gsub(/^"|"[ \t]*$/, "")
      print
      exit
    }
  ' "$1"
}

# require_text <file> <needle> <label>
require_text() {
  if [ ! -s "$1" ]; then
    fail "$3: $1 is missing or empty"
    return
  fi
  if ! grep -qF "$2" "$1"; then
    fail "$3: $1 does not contain the expected text \"$2\""
  fi
}

for manifest in "$ROOT"/services/*/Cargo.toml; do
  [ -e "$manifest" ] || continue
  dir="$(dirname -- "$manifest")"
  rel="services/$(basename -- "$dir")"
  CHECKED=$((CHECKED + 1))

  license="$(package_field "$manifest" license || true)"
  description="$(package_field "$manifest" description || true)"
  repository="$(package_field "$manifest" repository || true)"
  readme="$(package_field "$manifest" readme || true)"

  [ -n "$license" ]     || fail "$rel: [package] has no license"
  [ -n "$description" ] || fail "$rel: [package] has no description (crates.io requires one)"
  [ -n "$repository" ]  || fail "$rel: [package] has no repository"
  [ -n "$readme" ]      || fail "$rel: [package] has no readme"

  if [ -n "$readme" ] && [ ! -s "$dir/$readme" ]; then
    fail "$rel: readme = \"$readme\" but $rel/$readme is missing or empty"
  fi

  case "$license" in
    "MIT OR Apache-2.0")
      require_text "$dir/LICENSE-MIT" "MIT License" "$rel"
      require_text "$dir/LICENSE-MIT" \
        "Permission is hereby granted, free of charge" "$rel"
      require_text "$dir/LICENSE-APACHE" "Apache License" "$rel"
      require_text "$dir/LICENSE-APACHE" "Version 2.0, January 2004" "$rel"
      require_text "$dir/LICENSE-APACHE" "END OF TERMS AND CONDITIONS" "$rel"
      require_text "$dir/README.md" "LICENSE-APACHE" "$rel"
      require_text "$dir/README.md" "LICENSE-MIT" "$rel"
      require_text "$dir/README.md" "dual licensed" "$rel"
      if [ -e "$dir/LICENSE" ]; then
        fail "$rel: declares MIT OR Apache-2.0 but also ships a bare LICENSE file"
      fi
      ;;
    "AGPL-3.0-only")
      require_text "$dir/LICENSE" "GNU AFFERO GENERAL PUBLIC LICENSE" "$rel"
      require_text "$dir/LICENSE" "Version 3, 19 November 2007" "$rel"
      require_text "$dir/README.md" "AGPL-3.0-only" "$rel"
      if ! grep -qi "not dual-licensed" "$dir/README.md" 2>/dev/null; then
        fail "$rel: README.md must state explicitly that the crate is NOT dual-licensed"
      fi
      for stray in LICENSE-MIT LICENSE-APACHE; do
        if [ -e "$dir/$stray" ]; then
          fail "$rel: declares AGPL-3.0-only but ships $stray, which advertises a grant it cannot give"
        fi
      done
      ;;
    *)
      fail "$rel: unrecognised licence expression \"$license\" — extend this gate deliberately (ADR-2030)"
      ;;
  esac
done

if [ "$CHECKED" -eq 0 ]; then
  echo "FAIL (check-crate-licensing): no package manifests found under services/" >&2
  exit 1
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "FAIL (check-crate-licensing): $FAILURES problem(s) across $CHECKED package directories." >&2
  echo "  Each services/ crate must carry the licence texts and README its manifest declares (ADR-2030)." >&2
  exit 1
fi

echo "OK (check-crate-licensing): $CHECKED services/ package directories carry the texts they declare."
