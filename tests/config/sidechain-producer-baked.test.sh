#!/usr/bin/env bash
# Custody W5 (design §2.7, owner Q7) — config/sidechain/run-producer.sh runs the baked upstream.
#
# The property under test: the producer executes consensus code that its own user cannot modify.
# By default it runs the image's read-only bake (lib/sidestr-upstream.nix, linked at
# /opt/agentbox/sidestr/upstream), whose recorded commits (.pin-commit, written at build time) must
# equal config/sidechain/upstream-pins. A workspace checkout runs only under
# SIDESTR_ALLOW_UNPINNED=1, and then says SIDESTR-UNPINNED. The bake here is a fake: a temp tree
# with .pin-commit files, made read-only as the store is. The engine is a stub that records its
# argv and the SCHEMA / BLAKETESTNODE it was given. No chain process, no node, no key material.
#
# Cases:
#   1. baked tree at the pins, no override          -> runs the baked siding.mjs, SCHEMA and
#                                                       BLAKETESTNODE from the bake; no marker
#   2. one .pin-commit differs from upstream-pins   -> refuses, naming the stale bake
#   3. one .pin-commit missing                      -> refuses (an unrecorded commit is not a pin)
#   4. the bake is writable by the producer's user  -> refuses (a writable tree is a checkout)
#   5. no bake in the image, no override            -> refuses, naming the override
#   6. SIDESTR_UPSTREAM set without the override    -> refuses; the checkout is not run
#   7. SIDESTR_ALLOW_UNPINNED=1                     -> runs the checkout, not the bake, and logs
#                                                       SIDESTR-UNPINNED
#   8. a chain naming the evm rule, bake without
#      @ethereumjs                                  -> refuses before the engine fails lazily
# Run: bash tests/config/sidechain-producer-baked.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
RUNNER="$REPO/config/sidechain/run-producer.sh"
PINS="$REPO/config/sidechain/upstream-pins"
DOC="$REPO/config/sidechain/dreamlab/chain.json"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sidechain-producer-baked.XXXXXX")"
cleanup() { chmod -R u+w "$ROOT" 2>/dev/null; rm -rf "$ROOT"; }
trap cleanup EXIT

pin() { awk -v d="$1" '$1 == d { print $2 }' "$PINS"; }

# stub_tree <dir> <tag>: the three upstream entry points; siding.mjs records argv, its own tag and env.
stub_tree() {
  mkdir -p "$1/spec/siding/bin" "$1/schema/codec" "$1/blaketestnode/lib"
  cat >"$1/spec/siding/bin/siding.mjs" <<JS
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.STUB_ARGS_OUT, JSON.stringify({ tree: '$2', schema: process.env.SCHEMA, btn: process.env.BLAKETESTNODE, argv: process.argv.slice(2) }));
JS
  : >"$1/schema/codec/kernel.js"; : >"$1/blaketestnode/lib/node.mjs"
}
# bake <dir>: a fresh baked tree at the pins, read-only.
bake() {
  [ -d "$1" ] && chmod -R u+w "$1" && rm -rf "$1"
  stub_tree "$1" baked
  for d in spec schema blaketestnode; do pin "$d" >"$1/$d/.pin-commit"; done
}
seal() { chmod -R a-w "$1"; }

BAKED="$ROOT/baked"
CHECKOUT="$ROOT/ws/sidestr/upstream"
stub_tree "$CHECKOUT" checkout
printf 'stub\n' >"$ROOT/signer.key"
printf 'user:not-a-real-password\n' >"$ROOT/rpc.cred"

# run [VAR=value ...]: the runner on sidestr:dreamlab (tbtc4: no fork check); sets $rc, $err, $out
run() {
  rm -f "$ROOT/args"
  err="$(env -i HOME="$ROOT" PATH="$PATH" WORKSPACE="$ROOT/ws" \
    SIDESTR_UPSTREAM_BAKED="$BAKED" SIDESTR_KEY="$ROOT/signer.key" SIDESTR_DOC="$DOC" \
    SIDESTR_PARENT_COOKIE="$ROOT/rpc.cred" SIDESTR_PARENT_RPC="http://127.0.0.1:9/" \
    STUB_ARGS_OUT="$ROOT/args" "$@" bash "$RUNNER" 2>&1 >/dev/null)"; rc=$?
  out="$(cat "$ROOT/args" 2>/dev/null || true)"
}
field() { printf '%s' "$out" | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8") || "{}"); process.stdout.write(String(o[process.argv[1]] ?? ""))' -- "$1"; }

echo "sidechain producer runs the baked upstream (custody W5, design §2.7)"

if [ "$(id -u)" = 0 ]; then
  echo "  skip: run as a non-root user (root writes through read-only modes, so case 4 cannot hold)"
  exit 0
fi

bake "$BAKED"; seal "$BAKED"
run
if [ "$rc" = 0 ] && [ "$(field tree)" = baked ] && [ "$(field schema)" = "$BAKED/schema" ] \
   && [ "$(field btn)" = "$BAKED/blaketestnode" ] && ! printf '%s' "$err" | grep -q 'SIDESTR-UNPINNED'; then
  ok "default: the baked tree at the pins runs, schema and blaketestnode included, no marker"
else bad "default: the baked tree at the pins runs" "rc=$rc out=$out err=$err"; fi

bake "$BAKED"; printf '0000000000000000000000000000000000000000\n' >"$BAKED/schema/.pin-commit"; seal "$BAKED"
run
if [ "$rc" != 0 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q 'stale bake' && printf '%s' "$err" | grep -q "$(pin schema)"; then
  ok "stale bake (.pin-commit != upstream-pins): refused, naming the pin"
else bad "stale bake: refused" "rc=$rc out=$out err=$err"; fi

bake "$BAKED"; rm "$BAKED/blaketestnode/.pin-commit"; seal "$BAKED"
run
if [ "$rc" != 0 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q 'stale bake'; then
  ok "bake with no recorded commit for a pin: refused"
else bad "bake with no recorded commit: refused" "rc=$rc out=$out err=$err"; fi

bake "$BAKED"; seal "$BAKED"; chmod u+w "$BAKED/spec/siding/bin/siding.mjs"
run
if [ "$rc" != 0 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q 'writable'; then
  ok "a bake the producer's user can write: refused (a writable tree is a checkout)"
else bad "writable bake: refused" "rc=$rc out=$out err=$err"; fi

run SIDESTR_UPSTREAM_BAKED="$ROOT/nowhere"
if [ "$rc" != 0 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q 'SIDESTR_ALLOW_UNPINNED=1'; then
  ok "no bake in the image: refused, naming the override"
else bad "no bake in the image: refused" "rc=$rc out=$out err=$err"; fi

bake "$BAKED"; seal "$BAKED"
run SIDESTR_UPSTREAM="$CHECKOUT"
if [ "$rc" != 0 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q 'SIDESTR_UPSTREAM'; then
  ok "SIDESTR_UPSTREAM without the override: refused, the checkout is not run"
else bad "SIDESTR_UPSTREAM without the override: refused" "rc=$rc out=$out err=$err"; fi

run SIDESTR_ALLOW_UNPINNED=1
if [ "$rc" = 0 ] && [ "$(field tree)" = checkout ] && [ "$(field schema)" = "$CHECKOUT/schema" ] \
   && printf '%s' "$err" | grep -q 'SIDESTR-UNPINNED'; then
  ok "SIDESTR_ALLOW_UNPINNED=1: the workspace checkout runs and SIDESTR-UNPINNED is logged"
else bad "SIDESTR_ALLOW_UNPINNED=1: checkout with marker" "rc=$rc out=$out err=$err"; fi

node -e 'const fs = require("fs"); const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); c.rules = ["evm"]; fs.writeFileSync(process.argv[2], JSON.stringify(c))' "$DOC" "$ROOT/evm-chain.json"
run SIDESTR_DOC="$ROOT/evm-chain.json"
if [ "$rc" != 0 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q 'evm'; then
  ok "a chain naming the evm rule on a bake without @ethereumjs: refused at start"
else bad "evm chain without @ethereumjs: refused" "rc=$rc out=$out err=$err"; fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
