#!/usr/bin/env bash
# ADR-2098 (amended 2026-10-02, sidestr SPEC 0.0.5) — the mirror serves chain-event.json.
#
# config/sidechain/mirror-sync.sh copies chain.json, blocks.dat and blocks.json into a
# GitHub Pages checkout. chain-event.json (the kind-3500 chain event, whose id is the
# chain's hash) joins that set when it exists beside the chain document, and its absence
# is not an error. Everything runs against throwaway git repositories under a temp dir
# with a synthetic event (structural fields only; the mirror does not verify signatures);
# no real chain event is made or published.
#
# Cases:
#   1. absent: the loop commits and pushes the three files, no chain-event.json, no error
#   2. present: chain-event.json is copied, committed and pushed beside them
#   3. a different event over a published one is refused; the published one stays
#   4. an event for another alias is not mirrored
#   5. state dir: the event in the writable state dir is mirrored when none sits beside the document
# Run: bash tests/config/sidechain-mirror-chain-event.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SYNC="$HERE/../../config/sidechain/mirror-sync.sh"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sidechain-mirror-chain-event.XXXXXX")"
pid=""
cleanup() { [ -n "$pid" ] && kill "$pid" 2>/dev/null; wait 2>/dev/null; rm -rf "$ROOT"; }
trap cleanup EXIT

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

g() { git -C "$1" "${@:2}"; }

# event <id hex char> <alias> -> a structurally valid kind-3500 event as JSON
event() {
  local c="$1" alias="$2" id pk sig
  id="$(printf "%064d" 0 | tr 0 "$c")"; pk="$(printf "%064d" 0 | tr 0 7)"; sig="$(printf "%0128d" 0 | tr 0 9)"
  jq -n --arg id "$id" --arg pk "$pk" --arg sig "$sig" --arg alias "$alias" \
    '{id:$id, pubkey:$pk, sig:$sig, kind:3500, created_at:1790900000,
      tags:[["n",$alias],["t","sidestr"]], content:({id:$alias, parent:"tbtc4"} | tojson)}'
}

# setup <case>: a bare remote, a pages checkout seeded and pushed, a state dir with a new block
setup() {
  local c="$ROOT/$1"
  mkdir -p "$c/pages" "$c/state" "$c/doc"
  git init -q --bare "$c/remote.git"
  g "$c/pages" init -q -b main
  g "$c/pages" config user.email fixture@example.invalid
  g "$c/pages" config user.name "Synthetic fixture"
  g "$c/pages" config commit.gpgsign false
  printf '{"id":"sidestr:dreamlab"}' >"$c/pages/chain.json"
  printf 'old' >"$c/pages/blocks.dat"; printf '{"to":0}' >"$c/pages/blocks.json"
  g "$c/pages" add . && g "$c/pages" commit -q -m seed
  g "$c/pages" remote add origin "$c/remote.git"
  g "$c/pages" push -q -u origin main 2>/dev/null
  printf 'new' >"$c/state/blocks.dat"; printf '{"to":1}' >"$c/state/blocks.json"
  printf '{"id":"sidestr:dreamlab"}' >"$c/doc/chain.json"
}

# run_once <case>: one pass of the loop (it sleeps after the first pass; stop it there)
run_once() {
  local c="$ROOT/$1" log="$ROOT/$1.log"
  SIDESTR_STATE="$c/state" SIDESTR_PRODUCER_URL=http://127.0.0.1:1 SIDESTR_DOC="$c/doc/chain.json" \
    bash "$SYNC" "$c/pages" 30 >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 100); do
    grep -q 'mirror synchronized\|push failed' "$log" 2>/dev/null && break
    [ -n "$(g "$c/remote.git" log -1 --format=%s main 2>/dev/null | grep 'mirror: tip')" ] && break
    sleep 0.1
  done
  sleep 0.3
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; pid=""
}

echo "sidechain mirror: chain-event.json (ADR-2098 amended)"

# 1. absent
setup absent; run_once absent
if [ "$(g "$ROOT/absent/remote.git" show main:blocks.json 2>/dev/null)" = '{"to":1}' ] \
   && ! g "$ROOT/absent/remote.git" ls-tree --name-only main | grep -qx chain-event.json \
   && [ ! -e "$ROOT/absent/pages/chain-event.json" ] \
   && ! grep -q 'not a kind-3500\|refusing\|error\|pathspec' "$ROOT/absent.log"; then
  ok "absent: blocks pushed, no chain-event.json, nothing logged against it"
else bad "absent: blocks pushed, no chain-event.json" "$(cat "$ROOT/absent.log")"; fi

# 2. present
setup present; event a sidestr:dreamlab >"$ROOT/present/doc/chain-event.json"; run_once present
want="$(jq -r .id "$ROOT/present/doc/chain-event.json")"
if [ "$(g "$ROOT/present/remote.git" show main:chain-event.json 2>/dev/null | jq -r .id)" = "$want" ] \
   && [ "$(g "$ROOT/present/remote.git" show main:blocks.json 2>/dev/null)" = '{"to":1}' ]; then
  ok "present: chain-event.json copied, committed and pushed with the blocks"
else bad "present: chain-event.json copied, committed and pushed" "$(cat "$ROOT/present.log")"; fi

# 3. a different event over a published one is refused
setup swap
event a sidestr:dreamlab >"$ROOT/swap/pages/chain-event.json"
g "$ROOT/swap/pages" add chain-event.json && g "$ROOT/swap/pages" commit -q -m "published event" && g "$ROOT/swap/pages" push -q 2>/dev/null
event b sidestr:dreamlab >"$ROOT/swap/doc/chain-event.json"; run_once swap
published="$(printf "%064d" 0 | tr 0 a)"
if [ "$(g "$ROOT/swap/remote.git" show main:chain-event.json | jq -r .id)" = "$published" ] \
   && [ "$(jq -r .id "$ROOT/swap/pages/chain-event.json")" = "$published" ] \
   && grep -q 'refusing to replace' "$ROOT/swap.log"; then
  ok "a published chain event is never replaced by another"
else bad "a published chain event is never replaced by another" "$(cat "$ROOT/swap.log")"; fi

# 4. an event for another alias is not mirrored
setup foreign; event c sidestr:other >"$ROOT/foreign/doc/chain-event.json"; run_once foreign
if [ ! -e "$ROOT/foreign/pages/chain-event.json" ] \
   && [ "$(g "$ROOT/foreign/remote.git" show main:blocks.json 2>/dev/null)" = '{"to":1}' ] \
   && grep -q 'not a kind-3500 event for sidestr:dreamlab' "$ROOT/foreign.log"; then
  ok "an event for another alias is not mirrored; the blocks still are"
else bad "an event for another alias is not mirrored" "$(cat "$ROOT/foreign.log")"; fi

# 5. state dir fallback (the image's document dir is read-only)
setup statedir; event d sidestr:dreamlab >"$ROOT/statedir/state/chain-event.json"; run_once statedir
want="$(jq -r .id "$ROOT/statedir/state/chain-event.json")"
if [ "$(g "$ROOT/statedir/remote.git" show main:chain-event.json 2>/dev/null | jq -r .id)" = "$want" ]; then
  ok "state dir: the event beside the state, not the document, is mirrored"
else bad "state dir: the event beside the state is mirrored" "$(cat "$ROOT/statedir.log")"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
