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

# --- Evasions the original awk matcher missed (W3-04 review). Each must fail. ---
try "renamed dependency, inline (package = sidestr-core)" $'[dependencies]\nfoo = { package = "sidestr-core", path = "../x" }'
try "renamed dependency, table form" $'[dependencies.foo]\npackage = "sidestr-core"\ngit = "https://example.invalid/x"'
try "renamed dependency, underscore package name" $'[build-dependencies]\nfoo = { package = "sidestr_core", path = "../x" }'
try "dotted key (sidestr-core.path)" $'[dependencies]\nsidestr-core.path = "../x"'
try "dotted key on a renamed dependency" $'[dependencies]\nfoo.package = "sidestr-core"\nfoo.git = "https://example.invalid/x"'
try "[replace] in its real form (name:version key)" $'[replace]\n"sidestr-core:0.4.0" = { path = "../x" }'
try "[replace] with a registry-qualified id" $'[replace]\n"registry+https://github.com/rust-lang/crates.io-index#sidestr-core:0.4.0" = { git = "https://example.invalid/x" }'
try "quoted table header" $'[dependencies."sidestr-core"]\npath = "../x"'
try "single-quoted key" $'[dependencies]\n\'sidestr-core\' = { path = "../x" }'
try "quoted \"path\" key" $'[dependencies]\nsidestr-core = { "path" = "../x" }'
try "target-specific dependency" $'[target.\'cfg(unix)\'.dependencies]\nsidestr-core = { path = "../x" }'
try "workspace.dependencies entry" $'[workspace.dependencies]\nsidestr-core = { git = "https://example.invalid/x" }'
try "patch entry under a renamed key" $'[patch.crates-io]\nfoo = { package = "sidestr-core", path = "../x" }'
try "multi-line inline-table value" $'[dependencies]\nsidestr-core = {\n  version = "0.4",\n  path = "../x",\n}'

try_file() { # name, relative path, body — the file is written verbatim
  rm -rf "$T/other"; mkdir -p "$T/$(dirname "$2")"
  printf '%s\n' "$3" > "$T/$2"
  out="$(run)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "$2"; then ok "$1 is rejected"; else bad "$1 is rejected (rc=$rc): $out"; fi
  rm -rf "$T/other"; mkdir -p "$T/other"
}
try_file ".cargo/config.toml [patch] path" other/.cargo/config.toml $'[patch.crates-io]\nsidestr-core = { path = "../x" }'
try_file ".cargo/config.toml [patch] renamed" other/.cargo/config.toml $'[patch.crates-io]\nfoo = { package = "sidestr-core", git = "https://example.invalid/x" }'
try_file ".cargo/config.toml paths naming a sidestr directory" other/.cargo/config.toml $'paths = ["../sidestr-rs/crates/sidestr-core"]'
try_file "manifest under a real directory named target" other/target/pkg/Cargo.toml $'[dependencies]\nsidestr-core = { path = "../x" }'
try_file "manifest under a real directory named result" other/result/pkg/Cargo.toml $'[dependencies]\nsidestr-core = { path = "../x" }'
try_file "manifest under a nested resultfoo directory" other/a/b/result-old/Cargo.toml $'[dependencies]\nsidestr-core = { path = "../x" }'
try_file "an unparseable manifest (cannot be proven clean)" other/Cargo.toml $'[dependencies\nsidestr-core = { path = "../x" }'

# --- Cases that must pass. ---
passes() { # name, relative path, body
  rm -rf "$T/other"; mkdir -p "$T/$(dirname "$2")"
  printf '%s\n' "$3" > "$T/$2"
  out="$(run)"; rc=$?
  [ "$rc" -eq 0 ] && ok "$1 passes" || bad "$1 passes: $out"
  rm -rf "$T/other"; mkdir -p "$T/other"
}
passes "non-sidestr path dependency and commented line" other/Cargo.toml $'[package]\nname = "x"\nversion = "0.1.0"\n[dependencies]\nfoo = { path = "../foo" }\n# sidestr-core = { path = "../x" }'
passes "renamed registry dependency on sidestr-core" other/Cargo.toml $'[dependencies]\nfoo = { package = "sidestr-core", version = "=0.4.0" }'
passes "sidestr key renamed to a different package" other/Cargo.toml $'[dependencies]\nsidestr-core = { package = "serde", path = "../serde" }'
passes "workspace-inherited sidestr dependency" other/Cargo.toml $'[dependencies]\nsidestr-core = { workspace = true }'
passes "workspace.dependencies registry version" other/Cargo.toml $'[workspace.dependencies]\nsidestr-core = "=0.4.0"'
passes "target-specific registry sidestr dependency" other/Cargo.toml $'[target.\'cfg(unix)\'.dependencies]\nsidestr-core = { version = "0.4", features = ["x"] }'
passes ".cargo/config.toml without sidestr" other/.cargo/config.toml $'[patch.crates-io]\nfoo = { path = "../foo" }\n[build]\njobs = 2'
# A target directory carrying the marker cargo writes is real build output.
rm -rf "$T/other"; mkdir -p "$T/other/target/pkg"
printf '[dependencies]\nsidestr-core = { path = "../x" }\n' > "$T/other/target/pkg/Cargo.toml"
printf 'Signature: 8a477f597d28d172789f06886806bc55\n' > "$T/other/target/CACHEDIR.TAG"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && ok "target directory carrying cargo's CACHEDIR.TAG is pruned" || bad "target directory carrying CACHEDIR.TAG is pruned: $out"
rm -rf "$T/other"; mkdir -p "$T/other/real"
printf '[dependencies]\nsidestr-core = { path = "../x" }\n' > "$T/other/real/Cargo.toml"
ln -s real "$T/other/result"
rm -rf "$T/other/real/Cargo.toml"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && ok "result symlink (nix build output) is not followed" || bad "result symlink is not followed: $out"
rm -rf "$T/other"; mkdir -p "$T/other"

# node_modules is not scanned.
mkdir -p "$T/other/node_modules/y"; printf '[dependencies]\nsidestr-core = { path = "../x" }\n' > "$T/other/node_modules/y/Cargo.toml"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && ok "node_modules manifests are skipped" || bad "node_modules manifests are skipped: $out"

# The real tree passes.
sh "$GATE" >/dev/null 2>&1 && ok "the repository itself passes" || bad "the repository itself passes"

echo "1..$((pass+fail))"; echo "# crate-licensing-sidestr-source: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
