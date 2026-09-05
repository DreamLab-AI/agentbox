#!/usr/bin/env bash
# ADR-2020 — cross-PROCESS contract test for the tree-search cost cap.
#
# The unit tests in services/agentbox-ops/src/cost_cap/mod_tests.rs prove the
# limiter's arithmetic and its thread safety. This test proves the property that
# actually matters for the real dispatch path: the orchestration is a sequence
# of separate `tree-search-cap` process invocations, so the cap must hold across
# processes, not just across threads in one address space.
#
# Run: bash tests/capability/tree-search-cap.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CRATE="$REPO/services/agentbox-ops"

pass=0
fail=0
ok()   { echo "ok   — $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL — $1"; shift; printf '%s\n' "$@" | sed 's/^/       | /'; fail=$((fail + 1)); }

echo "building tree-search-cap…"
if ! (cd "$CRATE" && cargo build --offline --quiet --bin tree-search-cap 2>&1); then
  echo "FAIL — cargo build --bin tree-search-cap"
  exit 1
fi
BIN="$CRATE/target/debug/tree-search-cap"
[ -x "$BIN" ] || { echo "FAIL — $BIN not built"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
MANIFEST="$WORK/agentbox.toml"
cat > "$MANIFEST" <<'EOF'
[skills.tree_search_coder]
enabled = true
max_candidates = 5
per_branch_timeout_s = 60
spend_cap_usd = 0.50
EOF

cap() { "$BIN" --manifest "$MANIFEST" --ledger "$WORK/ledger.json" "$@"; }

# --- 1. the effective config comes from the manifest ----------------------
out="$(cap config)"; rc=$?
if [ "$rc" -eq 0 ] \
  && printf '%s' "$out" | grep -q '"spend_cap_usd": 0.5' \
  && printf '%s' "$out" | grep -q '"defaulted": \[\]'; then
  ok "config reads the declared cap (no defaulting)"
else
  bad "config reads the declared cap" "$out"
fi

# --- 2. under-cap reserve + settle ---------------------------------------
out="$(cap reserve --run r1 --estimate 0.10)"; rc=$?
RES="$(printf '%s' "$out" | sed -n 's/.*"id": "\(res-[a-f0-9]*\)".*/\1/p' | head -1)"
if [ "$rc" -eq 0 ] && [ -n "$RES" ]; then
  ok "under-cap reserve granted ($RES)"
else
  bad "under-cap reserve granted" "$out"
fi
out="$(cap settle --run r1 --reservation "$RES" --actual 0.08)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q '"committed_usd": 0.08'; then
  ok "settle on the success path charges the actual cost"
else
  bad "settle on the success path" "$out"
fi

# --- 3. a single over-cap reserve is refused with exit 3 -----------------
out="$(cap reserve --run r1 --estimate 0.99)"; rc=$?
if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q '"error": "spend_cap_exceeded"'; then
  ok "over-cap reserve refused with typed error and exit 3"
else
  bad "over-cap reserve refused (exit $rc)" "$out"
fi

# --- 4. failure path releases the hold ------------------------------------
out="$(cap reserve --run r2 --estimate 0.40)"
RES2="$(printf '%s' "$out" | sed -n 's/.*"id": "\(res-[a-f0-9]*\)".*/\1/p' | head -1)"
out="$(cap reserve --run r2 --estimate 0.20)"; rc=$?
if [ "$rc" -eq 3 ]; then
  ok "an in-flight hold blocks a second branch"
else
  bad "an in-flight hold blocks a second branch (exit $rc)" "$out"
fi
out="$(cap settle --run r2 --reservation "$RES2" --actual 0.00 --failed)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q '"outcome": "failed"'; then
  ok "settle on the failure path releases the hold"
else
  bad "settle on the failure path" "$out"
fi
out="$(cap reserve --run r2 --estimate 0.20)"; rc=$?
if [ "$rc" -eq 0 ]; then
  ok "budget is available again after the failed branch is released"
else
  bad "budget available after failure release (exit $rc)" "$out"
fi
cap reset --run r2 >/dev/null

# --- 5. N CONCURRENT PROCESSES: exactly the ones that fit are admitted ----
# Cap 0.50, ten separate processes each asking for 0.20 → exactly two.
for i in $(seq 1 10); do
  ( cap reserve --run race --estimate 0.20 > "$WORK/out.$i" 2>&1; echo $? > "$WORK/rc.$i" ) &
done
wait
granted=0; refused=0; other=0
for i in $(seq 1 10); do
  rc="$(cat "$WORK/rc.$i")"
  case "$rc" in
    0) granted=$((granted + 1)) ;;
    3) refused=$((refused + 1)) ;;
    *) other=$((other + 1)) ;;
  esac
done
if [ "$granted" -eq 2 ] && [ "$refused" -eq 8 ] && [ "$other" -eq 0 ]; then
  ok "10 concurrent processes: exactly 2 admitted, 8 refused"
else
  bad "10 concurrent processes (granted=$granted refused=$refused other=$other)" \
      "$(cat "$WORK"/out.* 2>/dev/null)"
fi
out="$(cap status --run race)"
held="$(printf '%s' "$out" | sed -n 's/.*"outstanding_usd": \([0-9.]*\).*/\1/p' | head -1)"
if awk -v h="$held" 'BEGIN { exit !(h <= 0.5 + 1e-9) }'; then
  ok "joint in-flight holds never exceed the cap (outstanding=$held)"
else
  bad "joint in-flight holds exceeded the cap (outstanding=$held)" "$out"
fi

# --- 6. candidate ceiling ------------------------------------------------
for i in 1 2 3 4 5; do
  o="$(cap reserve --run cand --estimate 0.01)"
  r="$(printf '%s' "$o" | sed -n 's/.*"id": "\(res-[a-f0-9]*\)".*/\1/p' | head -1)"
  cap settle --run cand --reservation "$r" --actual 0.01 >/dev/null
done
out="$(cap reserve --run cand --estimate 0.01)"; rc=$?
if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q '"error": "candidate_limit_exceeded"'; then
  ok "the 6th candidate is refused at max_candidates=5"
else
  bad "candidate ceiling enforced (exit $rc)" "$out"
fi

# --- 7. absent cap → documented default, never unlimited -----------------
printf '[skills.codeact]\nenabled = true\n' > "$WORK/nocap.toml"
out="$("$BIN" --manifest "$WORK/nocap.toml" --ledger "$WORK/l2.json" config)"
if printf '%s' "$out" | grep -q '"spend_cap_usd": 0.5' \
  && printf '%s' "$out" | grep -q '"spend_cap_usd"' \
  && printf '%s' "$out" | grep -q 'defaulted'; then
  ok "an absent manifest block falls back to the documented 0.50 default"
else
  bad "absent manifest block default" "$out"
fi
out="$("$BIN" --manifest "$WORK/nocap.toml" --ledger "$WORK/l2.json" reserve --run d --estimate 5.00)"; rc=$?
if [ "$rc" -eq 3 ]; then
  ok "the default cap is enforced, not unlimited"
else
  bad "default cap enforced (exit $rc)" "$out"
fi

# --- 8. a disabled manifest gate refuses execution ------------------------
printf '[skills.tree_search_coder]\nenabled = false\nspend_cap_usd = 0.50\n' > "$WORK/off.toml"
out="$("$BIN" --manifest "$WORK/off.toml" --ledger "$WORK/l3.json" reserve --run e --estimate 0.01)"; rc=$?
if [ "$rc" -eq 3 ] && printf '%s' "$out" | grep -q '"error": "capability_disabled"'; then
  ok "a disabled capability refuses every reservation"
else
  bad "disabled capability refuses (exit $rc)" "$out"
fi

echo
echo "tree-search-cap: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
