#!/usr/bin/env bash
# ADR-2103 D3/D3a and SC5 — the boot gates in config/sidechain/run-producer.sh.
#
# The property under test: the producer refuses to start rather than make blocks on a parent it
# cannot vouch for, and never claims an anchor it does not write. The engine is a stub that
# records its arguments; the parent node is a loopback stub answering getblockhash. No chain
# process, no real node, no key material.
#
# Cases:
#   1. txbt4 chain, node on the fork branch  -> starts; no --checkpoint-every; no --parent-wallet
#      when SIDESTR_PARENT_WALLET is empty; says checkpoints are off; sends Basic auth
#   2. txbt4 chain, node on the stock branch -> refuses, naming the wrong branch (D3a)
#   3. txbt4 chain, parent unreachable       -> refuses (D3a cannot be checked)
#   4. manifest parent != sealed parent      -> refuses (D3)
#   5. checkpoint_every > 0 without a wallet -> refuses (no silent non-anchoring)
#   6. checkpoint_every > 0 with a wallet    -> passes --checkpoint-every and --checkpoint-wallet
#   7. sidestr:dreamlab defaults (tbtc4)     -> no fork check; --parent-wallet sidestr-peg as before
# Run: bash tests/config/sidechain-producer-gates.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
RUNNER="$REPO/config/sidechain/run-producer.sh"
TXBT4_DOC="$REPO/config/sidechain/dreamlab-txbt4/chain.json"
DREAMLAB_DOC="$REPO/config/sidechain/dreamlab/chain.json"
FORK=000000000000b9d1b7e1bb0e77215ee92c6ef7ec8f4473e23908380649e779b6
STOCK=0000000000cf9d15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sidechain-producer-gates.XXXXXX")"
RPC_PID=""
cleanup() { [ -n "$RPC_PID" ] && kill "$RPC_PID" 2>/dev/null; rm -rf "$ROOT"; }
trap cleanup EXIT

# A stub upstream: siding.mjs records argv; the other two files only need to exist.
UP="$ROOT/upstream"
mkdir -p "$UP/spec/siding/bin" "$UP/schema/codec" "$UP/blaketestnode/lib"
cat >"$UP/spec/siding/bin/siding.mjs" <<'JS'
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.STUB_ARGS_OUT, JSON.stringify(process.argv.slice(2)));
JS
: >"$UP/schema/codec/kernel.js"; : >"$UP/blaketestnode/lib/node.mjs"
printf 'stub\n' >"$ROOT/signer.key"
printf 'user:not-a-real-password\n' >"$ROOT/rpc.cred"

# A stub parent: getblockhash answers $STUB_HASH; the Authorization header is recorded.
cat >"$ROOT/rpc.cjs" <<'JS'
const http = require('node:http'), fs = require('node:fs');
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    fs.writeFileSync(process.env.AUTH_OUT, req.headers.authorization || '');
    const { method } = JSON.parse(body);
    const hash = fs.readFileSync(process.env.HASH_FILE, 'utf8').trim();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(method === 'getblockhash' ? { result: hash, error: null, id: 1 } : { result: null, error: { code: -32601, message: 'no' }, id: 1 }));
  });
});
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(process.env.PORT_OUT, String(srv.address().port)));
JS
echo "$FORK" >"$ROOT/hash"
AUTH_OUT="$ROOT/auth" HASH_FILE="$ROOT/hash" PORT_OUT="$ROOT/port" node "$ROOT/rpc.cjs" &
RPC_PID=$!
for _ in $(seq 50); do [ -s "$ROOT/port" ] && break; sleep 0.1; done
RPC="http://127.0.0.1:$(cat "$ROOT/port")/"

# run <label> [VAR=value ...]: the runner with the stubs; sets $rc, $err, $args
run() {
  rm -f "$ROOT/args"; shift
  err="$(env -i HOME="$ROOT" PATH="$PATH" WORKSPACE="$ROOT/ws" \
    SIDESTR_UPSTREAM="$UP" SIDESTR_ALLOW_UNPINNED=1 SIDESTR_KEY="$ROOT/signer.key" \
    SIDESTR_PARENT_COOKIE="$ROOT/rpc.cred" STUB_ARGS_OUT="$ROOT/args" "$@" \
    bash "$RUNNER" 2>&1 >/dev/null)"; rc=$?
  args="$(cat "$ROOT/args" 2>/dev/null || true)"
}
has() { printf '%s' "$args" | node -e 'const a = JSON.parse(require("fs").readFileSync(0, "utf8")); process.exit(a.includes(process.argv[1]) ? 0 : 1)' -- "$1"; }
after() { printf '%s' "$args" | node -e 'const a = JSON.parse(require("fs").readFileSync(0, "utf8")); const i = a.indexOf(process.argv[1]); process.stdout.write(i < 0 ? "" : String(a[i + 1]))' -- "$1"; }

TX=(SIDESTR_CHAIN=dreamlab-txbt4 SIDESTR_DOC="$TXBT4_DOC" SIDESTR_PARENT_RPC="$RPC" SIDESTR_PARENT_WALLET= SIDESTR_EXPECT_PARENT=txbt4)

echo "sidechain producer boot gates (ADR-2103 D3, D3a; SC5)"

run 1 "${TX[@]}"
if [ "$rc" = 0 ] && [ "$(after --chain)" = "$TXBT4_DOC" ] && ! has --checkpoint-every && ! has --parent-wallet \
   && printf '%s' "$err" | grep -q 'checkpoints off' && grep -q '^Basic ' "$ROOT/auth"; then
  ok "fork branch: starts, unanchored and said so, no peg wallet, Basic auth to the parent"
else bad "fork branch: starts, unanchored and said so, no peg wallet, Basic auth to the parent" "rc=$rc args=$args err=$err"; fi

echo "$STOCK" >"$ROOT/hash"
run 2 "${TX[@]}"
if [ "$rc" != 0 ] && [ -z "$args" ] && printf '%s' "$err" | grep -q 'wrong branch'; then ok "stock branch at the fork height: refused (D3a)"
else bad "stock branch at the fork height: refused (D3a)" "rc=$rc err=$err"; fi
echo "$FORK" >"$ROOT/hash"

run 3 "${TX[@]}" SIDESTR_PARENT_RPC="http://127.0.0.1:9/"
if [ "$rc" != 0 ] && [ -z "$args" ]; then ok "parent unreachable: refused"
else bad "parent unreachable: refused" "rc=$rc err=$err"; fi

run 4 "${TX[@]}" SIDESTR_EXPECT_PARENT=tbtc4
if [ "$rc" != 0 ] && [ -z "$args" ] && printf '%s' "$err" | grep -q 'sealed beside txbt4'; then ok "manifest parent disagrees with the sealed document: refused (D3)"
else bad "manifest parent disagrees with the sealed document: refused (D3)" "rc=$rc err=$err"; fi

run 5 "${TX[@]}" SIDESTR_CHECKPOINT_EVERY=6
if [ "$rc" != 0 ] && [ -z "$args" ] && printf '%s' "$err" | grep -q 'needs SIDESTR_CHECKPOINT_WALLET'; then ok "checkpoints without a wallet: refused"
else bad "checkpoints without a wallet: refused" "rc=$rc err=$err"; fi

run 6 "${TX[@]}" SIDESTR_CHECKPOINT_EVERY=6 SIDESTR_CHECKPOINT_WALLET=sidestr-txbt4-fees
if [ "$rc" = 0 ] && [ "$(after --checkpoint-every)" = 6 ] && [ "$(after --checkpoint-wallet)" = sidestr-txbt4-fees ]; then ok "checkpoints with a wallet: both flags reach the engine"
else bad "checkpoints with a wallet: both flags reach the engine" "rc=$rc args=$args err=$err"; fi

run 7 SIDESTR_DOC="$DREAMLAB_DOC" SIDESTR_PARENT_RPC="http://127.0.0.1:9/"
if [ "$rc" = 0 ] && [ "$(after --parent-wallet)" = sidestr-peg ] && [ "$(after --port)" = 3450 ] && [ "$(after --parent-from)" = 153500 ] && [ "$(after --dir)" = "$ROOT/ws/sidestr/dreamlab" ]; then
  ok "sidestr:dreamlab defaults unchanged: no fork check on tbtc4, peg wallet sidestr-peg, :3450, from 153500"
else bad "sidestr:dreamlab defaults unchanged" "rc=$rc args=$args err=$err"; fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
