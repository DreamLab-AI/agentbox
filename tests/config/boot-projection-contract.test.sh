#!/usr/bin/env bash
# ADR-2104 — contract test for the boot-projection seal.
#
# The property under test: /run/agentbox/bootstrap.done means "the boot did
# what the manifest promised", not merely "the daemons came up". On
# 2026-09-18 the entrypoint stopped under `set -e` two blocks before the MCP
# hub projection; the sentinel was written anyway and agentbox-mcp-hub
# restarted for three days without ever binding its port.
#
# Cases:
#   1. gate on  + projection present -> sentinel written, exit 0
#   2. gate on  + projection MISSING -> no sentinel, exit 1, gate+path named
#   3. gate off + projection MISSING -> sentinel written (nothing promised)
#   4. entrypoint abort announcer prints the line and command it died on
#   5. the jev digest helper returns empty, not failure, for an absent tree
# Run: bash tests/config/boot-projection-contract.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SEAL="$REPO/config/seal-bootstrap.sh"
ENTRY="$REPO/config/entrypoint-unified.sh"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# A stub `agentbox-manifest toml-bool` whose answer is the file $T/gate.
mkdir -p "$T/bin"
cat > "$T/bin/agentbox-manifest" <<'STUB'
#!/usr/bin/env bash
cat "${STUB_GATE:?}"
STUB
chmod +x "$T/bin/agentbox-manifest"
: > "$T/manifest.toml"

# run_seal <gate 0|1> <run dir>  -> sets $rc, leaves output in $out
rc=0; out=''
run_seal() {
  echo "$1" > "$T/gate"
  PATH="$T/bin:$PATH" STUB_GATE="$T/gate" \
    AGENTBOX_RUN_DIR="$2" AGENTBOX_CONFIG="$T/manifest.toml" \
    BOOTSTRAP_PROJECTION_TIMEOUT=0 SUPERVISORD_CONF="$T/none.conf" \
    bash "$SEAL" --projections-only > "$T/out.txt" 2>&1
  rc=$?
  out="$(cat "$T/out.txt")"
}

echo "boot-projection contract (ADR-2104)"

# ── 1. gate on, projection present ───────────────────────────────────────────
R1="$T/run1"; mkdir -p "$R1"; echo '{}' > "$R1/mcp-hub.json"
run_seal 1 "$R1"
[ "$rc" -eq 0 ] && ok "gate on + projection present: exit 0" \
  || bad "gate on + projection present: exit 0" "rc=$rc out=$out"
[ -f "$R1/bootstrap.done" ] && ok "gate on + projection present: sentinel written" \
  || bad "gate on + projection present: sentinel written" "no $R1/bootstrap.done"
case "$out" in *BootstrapProjectionPresent*) ok "present projection is logged";;
  *) bad "present projection is logged" "$out";; esac

# ── 2. gate on, projection missing ───────────────────────────────────────────
R2="$T/run2"; mkdir -p "$R2"
run_seal 1 "$R2"
[ "$rc" -eq 1 ] && ok "gate on + projection missing: exit 1" \
  || bad "gate on + projection missing: exit 1" "rc=$rc out=$out"
[ ! -e "$R2/bootstrap.done" ] && ok "gate on + projection missing: NO sentinel" \
  || bad "gate on + projection missing: NO sentinel" "sentinel was written anyway"
case "$out" in *BootstrapProjectionMissing*) ok "missing projection raises BootstrapProjectionMissing";;
  *) bad "missing projection raises BootstrapProjectionMissing" "$out";; esac
case "$out" in *resources.mcp_hub.enabled*) ok "failure names the manifest gate";;
  *) bad "failure names the manifest gate" "$out";; esac
case "$out" in *mcp-hub.json*) ok "failure names the missing path";;
  *) bad "failure names the missing path" "$out";; esac

# ── 3. gate off, projection missing ──────────────────────────────────────────
R3="$T/run3"; mkdir -p "$R3"
run_seal 0 "$R3"
[ "$rc" -eq 0 ] && ok "gate off + projection missing: exit 0" \
  || bad "gate off + projection missing: exit 0" "rc=$rc out=$out"
[ -f "$R3/bootstrap.done" ] && ok "gate off: nothing promised, sentinel written" \
  || bad "gate off: nothing promised, sentinel written" "no $R3/bootstrap.done"

# ── 4. the entrypoint announces an abort instead of dying silently ───────────
grep -q "trap '_ab_boot_abort" "$ENTRY" \
  && ok "entrypoint registers the ERR abort announcer" \
  || bad "entrypoint registers the ERR abort announcer" "no ERR trap in $ENTRY"
out=$(bash -c '
  set -euo pipefail
  _ab_boot_abort() { printf "[bootstrap] ABORTED rc=%s at line %s — command: %s\n" "$1" "$2" "$3"; }
  trap '"'"'_ab_boot_abort "$?" "$LINENO" "$BASH_COMMAND"'"'"' ERR
  false
' 2>&1) || true
case "$out" in *"ABORTED rc=1"*"command: false"*) ok "abort announcer names rc and command";;
  *) bad "abort announcer names rc and command" "$out";; esac

# ── 5. the jev digest helper that killed the boot ────────────────────────────
digest_line="$(grep -n '_jc_digest() {' "$ENTRY" | head -1 | cut -d: -f2-)"
if bash -c "set -euo pipefail
${digest_line}
D=\"\$(_jc_digest '$T/absent')\"
[ -z \"\$D\" ]" 2>/dev/null; then
  ok "_jc_digest on an absent tree is empty, not a boot-ending failure"
else
  bad "_jc_digest on an absent tree is empty, not a boot-ending failure" \
    "the helper still returns non-zero under set -e"
fi

echo
printf 'boot-projection contract: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
