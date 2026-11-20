#!/usr/bin/env bash
# W3-04 — check-crate-licensing.sh must enforce the "sidestr-* crates come from
# crates.io only" rule (ADR-2106 D3, ADR-2112 D3), not just licence texts.
# Builds a throwaway repository root with one compliant services/ crate, then
# adds sidestr dependencies in each shape and asserts the gate's verdict.
# Run: bash tests/config/crate-licensing-sidestr-source.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/../../scripts/ci/check-crate-licensing.sh"
REAL="$(cd "$HERE/../.." && pwd)"
pass=0; fail=0
ok() { pass=$((pass+1)); echo "ok - $1"; }
bad() { fail=$((fail+1)); echo "not ok - $1"; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/services/demo" "$T/other"
# Reuse the real standard texts from a compliant permissive crate.
SRC="$REAL/services/agentbox-sessions"
cp "$SRC/LICENSE-MIT" "$SRC/LICENSE-APACHE" "$SRC/README.md" "$T/services/demo/"
cat > "$T/services/demo/Cargo.toml" <<'TOML'
[package]
name = "demo"
version = "0.1.0"
license = "MIT OR Apache-2.0"
description = "demo"
repository = "https://example.invalid/demo"
readme = "README.md"

[dependencies]
sidestr-core = "=0.4.0"
TOML

run() { CHECK_CRATE_LICENSING_ROOT="$T" sh "$GATE" 2>&1; }

out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && ok "registry-version sidestr dependency passes" || { bad "registry-version sidestr dependency passes: $out"; }

try() { # name, manifest body appended to other/Cargo.toml
  printf '[package]\nname = "x"\nversion = "0.1.0"\n%s\n' "$2" > "$T/other/Cargo.toml"
  out="$(run)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "other/Cargo.toml"; then ok "$1 is rejected"; else bad "$1 is rejected (rc=$rc): $out"; fi
}
try "inline path dependency" $'[dependencies]\nsidestr-core = { path = "../../sidestr-rs/crates/sidestr-core" }'
try "inline git dependency" $'[dependencies]\nsidestr-header = { git = "https://github.com/DreamLab-AI/sidestr-rs", rev = "abc" }'
try "table-form path dependency" $'[dependencies.sidestr-core]\npath = "../x"'
try "dev-dependency git, underscore spelling" $'[dev-dependencies]\nsidestr_core = { git = "https://example.invalid/x" }'
try "patch entry" $'[patch.crates-io]\nsidestr-core = { path = "../x" }'

# A non-sidestr path dependency and a commented-out sidestr path are fine.
printf '[package]\nname = "x"\nversion = "0.1.0"\n[dependencies]\nfoo = { path = "../foo" }\n# sidestr-core = { path = "../x" }\n' > "$T/other/Cargo.toml"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && ok "non-sidestr path dependency and commented line pass" || bad "non-sidestr path dependency passes: $out"

# node_modules / target are not scanned.
mkdir -p "$T/other/node_modules/y"; printf '[dependencies]\nsidestr-core = { path = "../x" }\n' > "$T/other/node_modules/y/Cargo.toml"
rm -f "$T/other/Cargo.toml"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && ok "node_modules manifests are skipped" || bad "node_modules manifests are skipped: $out"

# The real tree passes.
sh "$GATE" >/dev/null 2>&1 && ok "the repository itself passes" || bad "the repository itself passes"

echo "1..$((pass+fail))"; echo "# crate-licensing-sidestr-source: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
