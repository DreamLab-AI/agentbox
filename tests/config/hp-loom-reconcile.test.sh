#!/usr/bin/env bash
# ADR-2140 — scripts/hp-loom-reconcile.sh checks the HP Loom against the vault and, in full mode,
# publishes the committed HEAD through the documented pipeline. Everything is stubbed: a fake
# ontomark, fake Loom binaries, a fake ssh and a local HTTP stub for the Loom. The real HP and the
# real vault are never touched.
#
# Run: bash tests/config/hp-loom-reconcile.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
S="$(cd "$HERE/../.." && pwd)/scripts/hp-loom-reconcile.sh"
pass=0 fail=0
ok()  { echo "ok   — $1"; pass=$((pass + 1)); }
bad() { echo "FAIL — $1"; shift; printf '%s\n' "$@" | sed 's/^/       | /'; fail=$((fail + 1)); }
need() { command -v "$1" >/dev/null 2>&1 || { echo "skip — $1 not installed"; exit 0; }; }
need jq; need git; need python3; need curl; need flock

WORK="$(mktemp -d)"; trap 'kill $HTTP_PID 2>/dev/null; rm -rf "$WORK"' EXIT
REPO="$WORK/vault"; BIN="$WORK/bin"; LOOMBIN="$WORK/loombin"; STATE="$WORK/state"; PUB="$WORK/pub"
mkdir -p "$REPO" "$BIN" "$LOOMBIN"
git -C "$REPO" init -q && git -C "$REPO" config user.email t@t && git -C "$REPO" config user.name t
echo "committed page" > "$REPO/page.md"; git -C "$REPO" add -A; git -C "$REPO" commit -qm one
HEAD="$(git -C "$REPO" rev-parse HEAD)"
echo "private uncommitted work" > "$REPO/uncommitted.md"          # must never reach a build

# ── stubs ───────────────────────────────────────────────────────────────────────────────────────
cat > "$BIN/ontomark" <<EOF
#!/usr/bin/env bash
# ontomark --repo R validate --vault all   |   ontomark --repo R build --out O --with-rvdb --stats
R="\$2"
if [ "\$3" = validate ]; then echo "validate repo=\$R" >> "$WORK/validate.log"; [ -n "\${FAKE_VALIDATE_FAIL:-}" ] && exit 1; exit 0; fi
O="\$5"
echo "repo=\$R has_uncommitted=\$([ -e "\$R/uncommitted.md" ] && echo yes || echo no) is_worktree=\$([ -f "\$R/.git" ] && echo yes || echo no)" >> "$WORK/ontomark.log"
mkdir -p "\$O/data"; echo x > "\$O/data/ontology.ttl"
printf '{"id":"visionGraph@%s"}' "\$(git -C "\$R" rev-parse HEAD)" > "\$O/data/.generation.json"
EOF
cat > "$LOOMBIN/promote_vault_build" <<EOF
#!/usr/bin/env bash
echo promoted >> "$WORK/promote.log"
[ -n "\${FAKE_PROMOTE_FAIL:-}" ] && { echo refused >&2; exit 1; }
echo db > "\$2/ontology-corpus.rvdb"
EOF
cat > "$LOOMBIN/reload_published_generation" <<'EOF'
#!/usr/bin/env bash
# verify --data-dir D
D="$3"; [ -f "$D/ontology-corpus.rvdb" ] || exit 1
printf '{"generation":"%s","content_digest":"d"}' "$(jq -r .id "$D/.generation.json")"
EOF
cat > "$BIN/ssh" <<EOF
#!/usr/bin/env bash
echo "ssh \$*" >> "$WORK/ssh.log"
[ -n "\${FAKE_SSH_DOWN:-}" ] && exit 255
case "\$*" in
  *" true") exit 0 ;;
  *"tar -C"*) cat > "$WORK/upload.tar"; echo "upload \$(wc -c < "$WORK/upload.tar")" >> "$WORK/ssh.log"; exit 0 ;;
  *"bash -s"*) body="\$(cat)"
      if printf '%s' "\$body" | grep -q reload_published_generation; then
        printf '%s\\n' "\$body" > "$WORK/verify.sh"; [ -n "\${FAKE_HPVERIFY_FAIL:-}" ] && exit 4; exit 0
      fi
      printf '%s\\n' "\$body" > "$WORK/swap.sh"; [ -n "\${FAKE_SWAP_FAIL:-}" ] && exit 1; exit 0 ;;
  *"cat .local/state/loom/reload.json"*) echo '{"state":"refused","why":"digest mismatch"}'; exit 0 ;;
  *systemctl*) [ -n "\${FAKE_RELOAD_FAIL:-}" ] && exit 1; [ -n "\${FAKE_RELOAD_NOOP:-}" ] || cp "$WORK/next" "$WORK/served"; exit 0 ;;
esac
exit 0
EOF
chmod +x "$BIN"/* "$LOOMBIN"/*

printf 'visionGraph@%s' "0000000000000000000000000000000000000000" > "$WORK/served"
printf 'visionGraph@%s' "$HEAD" > "$WORK/next"
cat > "$WORK/stub.py" <<'PY'
import http.server, sys, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        open(sys.argv[3], "a").write("hit\n")
        sid = open(sys.argv[2]).read().strip()
        body = json.dumps({"id": sid}).encode() if sid else b"{}"
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
s = http.server.HTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(str(s.server_address[1])); s.serve_forever()
PY
python3 "$WORK/stub.py" "$WORK/port" "$WORK/served" "$WORK/http.log" & HTTP_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/port" ] && break; sleep 0.1; done
URL="http://127.0.0.1:$(cat "$WORK/port")"

run() { env VAULT_REPO="$REPO" LOOM_HP_HOST="${HOST_OVERRIDE-stub@hp}" LOOM_URL="${URL_OVERRIDE-$URL}" LOOM_BIN_DIR="${BIN_OVERRIDE:-$LOOMBIN}" ONTOMARK_BIN="$BIN/ontomark" \
        PUBLISH_DIR="$PUB" STATE_DIR="$STATE" SSH_BIN="$BIN/ssh" RELOAD_WAIT=6 BUILD_TIMEOUT=30 SHIP_TIMEOUT=30 "$@"; }
reset_logs() { : > "$WORK/ssh.log"; : > "$WORK/ontomark.log"; : > "$WORK/promote.log"; : > "$WORK/http.log"; : > "$WORK/validate.log"; rm -f "$WORK/upload.tar" "$WORK/swap.sh" "$WORK/verify.sh"; rm -rf "$PUB"; }
state() { jq -r .state "$STATE/hp-loom-reconcile.json" 2>/dev/null; }
stale() { printf 'visionGraph@%s' "0000000000000000000000000000000000000000" > "$WORK/served"; }
calls() { wc -l < "$1" | tr -d ' '; }

# 1. off
reset_logs; run bash "$S" --mode off 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ "$(state)" = off ] && [ "$(calls "$WORK/http.log")" = 0 ] && ok "off: recorded, Loom never asked" || bad "off" "rc=$rc state=$(state)"

# 2-3. check
reset_logs; printf 'visionGraph@%s' "$HEAD" > "$WORK/served"
run bash "$S" --mode check 2>/dev/null
[ "$(state)" = current ] && [ ! -s "$WORK/ssh.log" ] && ok "check: serving HEAD → current, no ssh" || bad "check current" "state=$(state)"
reset_logs; stale
run bash "$S" --mode check 2>/dev/null
[ "$(state)" = stale ] && [ ! -s "$WORK/ssh.log" ] && [ ! -s "$WORK/ontomark.log" ] && ok "check: stale → reported, nothing built, no ssh" || bad "check stale" "state=$(state)"
jq -e --arg h "$HEAD" '.vault_head == $h and .vault_uncommitted_files == 1 and (.served | startswith("visionGraph@0000"))' "$STATE/hp-loom-reconcile.json" >/dev/null \
  && ok "receipt names HEAD, the served id and the uncommitted-file count" || bad "receipt fields" "$(cat "$STATE/hp-loom-reconcile.json")"

# 4. Loom down
reset_logs; URL_OVERRIDE="http://127.0.0.1:1" run bash "$S" --mode full 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ "$(state)" = unreachable ] && [ ! -s "$WORK/ontomark.log" ] && ok "Loom unreachable: fail-open, exit 0, nothing built" || bad "Loom down" "rc=$rc state=$(state)"

# 5. full but already current: idempotent
reset_logs; printf 'visionGraph@%s' "$HEAD" > "$WORK/served"
run bash "$S" --mode full 2>/dev/null
[ "$(state)" = current ] && [ ! -s "$WORK/ssh.log" ] && [ ! -s "$WORK/ontomark.log" ] && ok "full + already current: no build, no ssh, no reload" || bad "full idempotent" "state=$(state)"

# 6. full, stale → published
reset_logs; stale
run bash "$S" --mode full 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ "$(state)" = reloaded ] && ok "full + stale: reloaded" || bad "full publish" "rc=$rc state=$(state)" "$(cat "$STATE/hp-loom-reconcile.json")"
grep -q 'has_uncommitted=no is_worktree=yes' "$WORK/ontomark.log" && ok "built from a clean DETACHED worktree: uncommitted work never reached the build" || bad "snapshot build" "$(cat "$WORK/ontomark.log")"
grep -q "repo=$REPO " "$WORK/ontomark.log" && bad "build ran against the live repo" "$(cat "$WORK/ontomark.log")" || ok "ontomark was never pointed at the live repo"
[ -s "$WORK/upload.tar" ] && tar -tf "$WORK/upload.tar" | grep -q 'ontology-corpus.rvdb' && ok "uploaded the promoted bundle" || bad "upload" "$(ls -la "$WORK" | head -3)"
grep -q 'promotion-in-flight' "$WORK/swap.sh" && grep -q 'data.rollback' "$WORK/swap.sh" && ok "swap script uses the in-flight marker and keeps data.rollback" || bad "swap script" "$(cat "$WORK/swap.sh" 2>&1)"
grep -E '^[^#]*rsync[^#]*--delete' "$WORK/swap.sh" >/dev/null && bad "swap script must never use --delete (data/ holds ledger.jsonl)" || ok "swap script never uses --delete"
jq -e '.steps == ["probe","tools","validate","build","promote","verify","ship","hp-verify","swap","reload"]' "$STATE/hp-loom-reconcile.json" >/dev/null \
  && ok "receipt records every step in order" || bad "steps" "$(jq -c .steps "$STATE/hp-loom-reconcile.json")"
[ "$(git -C "$REPO" worktree list | wc -l | tr -d ' ')" = 1 ] && ok "snapshot worktree removed afterwards" || bad "worktree left behind" "$(git -C "$REPO" worktree list)"

# 7. run again → nothing to do
before="$(calls "$WORK/ontomark.log")"; : > "$WORK/ssh.log"
run bash "$S" --mode full 2>/dev/null
[ "$(state)" = current ] && [ "$(calls "$WORK/ontomark.log")" = "$before" ] && [ ! -s "$WORK/ssh.log" ] && ok "second run: current, no rebuild, no ssh" || bad "second run" "state=$(state)"

# 8. bundle shipped but the Loom does not pick it up
reset_logs; stale
FAKE_RELOAD_NOOP=1 run bash "$S" --mode full 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ "$(state)" = shipped ] && ok "reload not observed: shipped (timer will retry), exit 0" || bad "shipped" "rc=$rc state=$(state)"

# 9. promote refuses → nothing leaves the machine
reset_logs; stale
FAKE_PROMOTE_FAIL=1 run bash "$S" --mode full 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ "$(state)" = failed ] && ! grep -q 'tar -C' "$WORK/ssh.log" && ok "promote refusal: failed, exit 0, nothing uploaded" || bad "promote refusal" "state=$(state)" "$(cat "$WORK/ssh.log")"

# 10. tools missing
reset_logs; stale
BIN_OVERRIDE="$WORK/nowhere" run bash "$S" --mode full 2>/dev/null
[ "$(state)" = degraded ] && [ ! -s "$WORK/ontomark.log" ] && ok "missing promote/verify binaries: degraded before any build" || bad "tools missing" "state=$(state)"

# 11. HP unreachable by ssh
reset_logs; stale
FAKE_SSH_DOWN=1 run bash "$S" --mode full 2>/dev/null
[ "$(state)" = unreachable ] && [ ! -s "$WORK/ontomark.log" ] && ok "ssh down: unreachable before any build" || bad "ssh down" "state=$(state)"

# 12. swap fails on the HP
reset_logs; stale
FAKE_SWAP_FAIL=1 run bash "$S" --mode full 2>/dev/null
[ "$(state)" = failed ] && jq -e '.detail | test("restored")' "$STATE/hp-loom-reconcile.json" >/dev/null && ok "swap failure: failed and says the previous generation was restored" || bad "swap failure" "$(cat "$STATE/hp-loom-reconcile.json")"
grep -q 'trap restore ERR' "$WORK/swap.sh" && ok "the remote swap restores data.rollback on error" || bad "restore trap missing"


# 12b. HP-side verify uses the HP's own binary, with no jq, and runs before the swap
grep -q 'reload_published_generation' "$WORK/verify.sh" 2>/dev/null || { reset_logs; stale; run bash "$S" --mode full 2>/dev/null; }
grep -q 'target/release/reload_published_generation' "$WORK/verify.sh" && ! grep -q 'jq' "$WORK/verify.sh" && ok "the HP verifies with its own binary and needs no jq" || bad "hp verify script" "$(cat "$WORK/verify.sh" 2>&1)"
reset_logs; stale
FAKE_HPVERIFY_FAIL=1 run bash "$S" --mode full 2>/dev/null
[ "$(state)" = failed ] && jq -e '.detail | test("HP.s own verify refused")' "$STATE/hp-loom-reconcile.json" >/dev/null && [ ! -f "$WORK/swap.sh" ] \
  && ok "HP verify refusal: failed, and the live data/ was never touched (no swap)" || bad "hp verify refusal" "state=$(state) swap=$([ -f "$WORK/swap.sh" ] && echo yes || echo no)"

# 12c. a failing HP reload service surfaces the HP's own receipt instead of promising a retry
reset_logs; stale
FAKE_RELOAD_FAIL=1 run bash "$S" --mode full 2>/dev/null
[ "$(state)" = failed ] && jq -e '.detail | test("digest mismatch")' "$STATE/hp-loom-reconcile.json" >/dev/null && ok "reload service failure: failed, quoting the HP's reload receipt" || bad "reload failure" "$(cat "$STATE/hp-loom-reconcile.json")"

# 12d. the vault's own gate: errors at HEAD mean nothing is built or sent
reset_logs; stale
FAKE_VALIDATE_FAIL=1 run bash "$S" --mode full 2>/dev/null
[ "$(state)" = refused ] && [ ! -s "$WORK/ontomark.log" ] && ! grep -q 'tar -C' "$WORK/ssh.log" && ok "validate errors: refused, nothing built, nothing sent" || bad "validate gate" "state=$(state)"
grep -q 'validate repo=' "$WORK/validate.log" && ! grep -q "validate repo=$REPO\$" "$WORK/validate.log" && ok "validate ran on the snapshot worktree, not the live repo" || bad "validate target" "$(cat "$WORK/validate.log")"

# 12e. only a settled commit is published
reset_logs; stale; touch "$REPO/.git/MERGE_HEAD"
run bash "$S" --mode full 2>/dev/null
[ "$(state)" = deferred ] && [ ! -s "$WORK/validate.log" ] && ok "merge in progress: deferred, nothing built" || bad "mid-merge" "state=$(state)"
rm -f "$REPO/.git/MERGE_HEAD"
reset_logs; stale; git -C "$REPO" checkout -q --detach
run bash "$S" --mode full 2>/dev/null
[ "$(state)" = deferred ] && jq -e '.detail | test("detached")' "$STATE/hp-loom-reconcile.json" >/dev/null && ok "detached HEAD: deferred" || bad "detached" "state=$(state)"
git -C "$REPO" checkout -q - 2>/dev/null || git -C "$REPO" checkout -q master 2>/dev/null || git -C "$REPO" checkout -q main 2>/dev/null

# 12f. --force publishes even when the Loom already serves HEAD (scratch-directory exercise)
reset_logs; printf 'visionGraph@%s' "$HEAD" > "$WORK/served"
run bash "$S" --mode full --force 2>/dev/null
[ -s "$WORK/ontomark.log" ] && [ -f "$WORK/swap.sh" ] && ok "--force: rebuilds and re-ships although the Loom is already current" || bad "--force" "state=$(state)"
reset_logs; printf 'visionGraph@%s' "$HEAD" > "$WORK/served"
run bash "$S" --mode check --force 2>/dev/null
[ "$(state)" = current ] && [ ! -s "$WORK/ssh.log" ] && ok "--force never turns check mode into a publish" || bad "--force check" "state=$(state)"

# 12g. ontomark is found on PATH when ONTOMARK_BIN is unset (the baked /opt path is tried first)
reset_logs; stale
env -u ONTOMARK_BIN VAULT_REPO="$REPO" LOOM_HP_HOST=stub@hp LOOM_URL="$URL" LOOM_BIN_DIR="$LOOMBIN" PUBLISH_DIR="$PUB" STATE_DIR="$STATE" \
    SSH_BIN="$BIN/ssh" RELOAD_WAIT=6 PATH="$BIN:$PATH" bash "$S" --mode full 2>/dev/null
[ "$(state)" = reloaded ] && [ -s "$WORK/ontomark.log" ] && ok "ONTOMARK_BIN unset: ontomark resolved from PATH" || bad "ontomark lookup" "state=$(state)"
grep -q 'opt/agentbox/bin/ontomark' "$S" && ok "the baked /opt/agentbox/bin/ontomark is the preferred lookup" || bad "baked lookup missing"

# 13. lock
reset_logs; stale
( exec 9>"$STATE/hp-loom-reconcile.lock"; flock -n 9; sleep 4 ) & LOCKER=$!
sleep 0.5
run bash "$S" --mode full 2>/dev/null
[ "$(state)" = busy ] && [ ! -s "$WORK/ontomark.log" ] && ok "a concurrent run is refused (busy), nothing built" || bad "lock" "state=$(state)"
wait "$LOCKER" 2>/dev/null

# 14. --strict
reset_logs; stale
run bash "$S" --mode check --strict 2>/dev/null; rc=$?
[ "$rc" -eq 1 ] && ok "--strict: stale exits 1" || bad "--strict stale" "rc=$rc"
printf 'visionGraph@%s' "$HEAD" > "$WORK/served"
run bash "$S" --mode check --strict 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "--strict: current exits 0" || bad "--strict current" "rc=$rc"

# 14b. unconfigured: no estate address is baked into the script
reset_logs; stale
URL_OVERRIDE="" run bash "$S" --mode check 2>/dev/null
[ "$(state)" = degraded ] && jq -e '.detail | test("loom_url")' "$STATE/hp-loom-reconcile.json" >/dev/null && ok "no LOOM_URL: degraded, names [vault].loom_url" || bad "no LOOM_URL" "$(cat "$STATE/hp-loom-reconcile.json")"
reset_logs; stale
HOST_OVERRIDE="" run bash "$S" --mode full 2>/dev/null
[ "$(state)" = degraded ] && jq -e '.detail | test("loom_host")' "$STATE/hp-loom-reconcile.json" >/dev/null && [ ! -s "$WORK/ontomark.log" ] && ok "full with no LOOM_HP_HOST: degraded before any build" || bad "no LOOM_HP_HOST" "$(cat "$STATE/hp-loom-reconcile.json")"
reset_logs; stale
HOST_OVERRIDE="" run bash "$S" --mode check 2>/dev/null
[ "$(state)" = stale ] && ok "check does not need the HP host" || bad "check without host" "state=$(state)"
grep -qE '192\.168\.|10\.10\.10\.|john@' "$S" && bad "the script must not hardcode estate addresses" || ok "the script hardcodes no estate address"

# 15. usage
run bash "$S" --mode bogus >/dev/null 2>&1; [ $? -eq 2 ] && ok "unknown mode exits 2" || bad "unknown mode"
run bash "$S" --nope >/dev/null 2>&1;       [ $? -eq 2 ] && ok "unknown flag exits 2" || bad "unknown flag"

echo
echo "hp-loom-reconcile: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
