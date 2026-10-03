#!/usr/bin/env bash
# RC-X1-06 — role secrets leave PID 1's environment under role isolation
# (custody X-1 step 1, W2, bypass 3).
#
# compose env_file feeds .env into PID 1 and every supervised child inherits it;
# identity.env exported AGENTBOX_NSEC on top. Under [security].role_isolation the
# entrypoint must hand each ROLE variable (config/custody/env-classes.json) to a
# file, export <NAME>_FILE, and unset <NAME> before supervisord starts. Flag off,
# the environment handed to supervisord must be byte-identical to today's.
#
# Asserts, against the real functions extracted from config/entrypoint-unified.sh:
#   1. flag off: capture + scrub leave the environment byte-identical
#   2. flag on: every ROLE var is gone, <NAME>_FILE points at a 0400 file holding it
#   3. a ROLE var already delivered by file (W1) is only unset, its file untouched
#   4. a present-but-empty ROLE var (compose `${X:-}`) is unset, no file written
#   5. the delivery never follows a planted symlink
#   6. the final scrub unsets a re-introduced ROLE var and logs ROLE-ISOLATION-LEAK
#   7. devuser-class and non-secret vars pass through unchanged under the flag
#   8. no value is ever printed
#   9. wiring: capture runs before the identity bootstrap, scrub right before exec
#  10. live (AGENTBOX_RC_LIVE=1 with the flag on): this shell carries no ROLE var
# shellcheck disable=SC2015,SC2016
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY="${HERE}/../../config/entrypoint-unified.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }
_done() { printf '1..%d\n# RC-X1-06: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/rc-x1-06.XXXXXX")"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
_extract() { awk -v n="$1" '$0 ~ "^"n"\\(\\) \\{" {f=1} f {print} f && /^}$/ {exit}' "$ENTRY"; }
LIST="$(grep -E '^_AB_ROLE_ENV_VARS="' "$ENTRY" | head -1)"
if [ -z "$LIST" ]; then _bad "_AB_ROLE_ENV_VARS is defined in the entrypoint"; _done; fi
FNS=""
for fn in _ab_role_owner _ab_role_env_capture _ab_role_env_scrub _ab_role_key_file_own; do
  body="$(_extract "$fn")"
  if [ -z "$body" ]; then _bad "${fn}() is defined in the entrypoint"; _done; fi
  FNS="${FNS}${body}"$'\n'
done
_ok "_AB_ROLE_ENV_VARS and the role-env functions are defined"
printf '%s\n%s\n' "$LIST" "$FNS" >"${TMP}/fns.sh"
eval "$LIST"
ROLE_NAMES="$(for t in $_AB_ROLE_ENV_VARS; do printf '%s ' "${t%%:*}"; done)"

# Synthetic values: recognisable, never real. Each run is a child bash so the
# environment under test is exactly what that process would hand to exec.
V1="$(printf 'a1%.0s' $(seq 32))"; V2="$(printf 'b2%.0s' $(seq 32))"; V3="$(printf 'c3%.0s' $(seq 32))"
_run() { # _run <flag> <secrets-root> <extra-bash> → env -0 dump at "exec" in $TMP/env.<tag>
  env -i PATH="$PATH" HOME="$TMP" \
    AGENTBOX_PRIVKEY_HEX="$V1" JUNKIEJARVIS_PRIVKEY_HEX="$V2" AGENTBOX_NSEC="nsec1synthetic" \
    TAILSCALE_AUTHKEY="" BRIDGE_TOKEN="$V3" ANTHROPIC_API_KEY="prov-synthetic" WORKSPACE=/w \
    bash -c 'set -euo pipefail; . "$1"; '"$3"'
      _ab_role_env_capture "$2" "$4"
      _ab_role_env_scrub "$2"
      env -0 | sort -z > "$5"' _ "${TMP}/fns.sh" "$1" "" "$2" "${TMP}/env.$4"
}

# ── 1. flag off: byte-identical ──────────────────────────────────────────────
env -i PATH="$PATH" HOME="$TMP" \
  AGENTBOX_PRIVKEY_HEX="$V1" JUNKIEJARVIS_PRIVKEY_HEX="$V2" AGENTBOX_NSEC="nsec1synthetic" \
  TAILSCALE_AUTHKEY="" BRIDGE_TOKEN="$V3" ANTHROPIC_API_KEY="prov-synthetic" WORKSPACE=/w \
  bash -c 'env -0 | sort -z > "$1"' _ "${TMP}/env.baseline"
OUT="$(_run 0 "${TMP}/sec-off" : off 2>&1)"
[ -s "${TMP}/env.off" ] && [ "$(sha256sum <"${TMP}/env.baseline")" = "$(sha256sum <"${TMP}/env.off")" ] \
  && _ok "flag off: the environment handed to supervisord is byte-identical" \
  || _bad "flag off must not change the environment" "names: $(tr '\0' '\n' <"${TMP}/env.off" 2>/dev/null | cut -d= -f1 | tr '\n' ' ')"
[ ! -e "${TMP}/sec-off" ] && _ok "flag off: nothing is written" || _bad "flag off must write no files"

# ── 2. flag on: delivered and unset ──────────────────────────────────────────
mkdir -p "${TMP}/sec-on"
OUT="$(_run 1 "${TMP}/sec-on" : on 2>&1)"
left=""
for n in $ROLE_NAMES; do tr '\0' '\n' <"${TMP}/env.on" | grep -q "^${n}=" && left="$left $n"; done
[ -z "$left" ] && _ok "flag on: no ROLE variable reaches supervisord" || _bad "ROLE vars survived the scrub" "$left"
fv="$(tr '\0' '\n' <"${TMP}/env.on" | sed -n 's/^AGENTBOX_PRIVKEY_HEX_FILE=//p')"
if [ -n "$fv" ] && [ -f "$fv" ] && [ "$(cat "$fv")" = "$V1" ] && [ "$(stat -c %a "$fv")" = 400 ]; then
  _ok "AGENTBOX_PRIVKEY_HEX → AGENTBOX_PRIVKEY_HEX_FILE (0400, exact bytes)"
else _bad "AGENTBOX_PRIVKEY_HEX must be delivered to a 0400 file" "file=${fv:-unset}"; fi
case "$fv" in "${TMP}/sec-on/ab-identity/"*) _ok "delivered under <secrets-root>/<role>/" ;; *) _bad "delivery path must be <root>/<role>/<NAME>" "$fv" ;; esac
fj="$(tr '\0' '\n' <"${TMP}/env.on" | sed -n 's/^JUNKIEJARVIS_PRIVKEY_HEX_FILE=//p')"
[ -n "$fj" ] && [ "$(cat "$fj" 2>/dev/null)" = "$V2" ] && _ok "JUNKIEJARVIS_PRIVKEY_HEX delivered" || _bad "JJ key must be delivered"
fn="$(tr '\0' '\n' <"${TMP}/env.on" | sed -n 's/^AGENTBOX_NSEC_FILE=//p')"
[ -n "$fn" ] && [ "$(cat "$fn" 2>/dev/null)" = "nsec1synthetic" ] && _ok "AGENTBOX_NSEC delivered" || _bad "nsec must be delivered"
[ "$(stat -c %a "${TMP}/sec-on/ab-identity")" = 500 ] && _ok "role dir is 0500" || _bad "role dir mode" "$(stat -c %a "${TMP}/sec-on/ab-identity")"

# ── 3. already delivered by file (W1) ────────────────────────────────────────
mkdir -p "${TMP}/w1"; printf 'w1-owned' >"${TMP}/w1/k"; chmod 0400 "${TMP}/w1/k"
_run 1 "${TMP}/sec-w1" "export AGENTBOX_PRIVKEY_HEX_FILE=${TMP}/w1/k" w1 >/dev/null 2>&1
tr '\0' '\n' <"${TMP}/env.w1" | grep -q '^AGENTBOX_PRIVKEY_HEX=' && _bad "pre-delivered var must still be unset" \
  || _ok "a ROLE var W1 already delivered is unset"
[ "$(cat "${TMP}/w1/k")" = "w1-owned" ] && [ ! -e "${TMP}/sec-w1/ab-identity/AGENTBOX_PRIVKEY_HEX" ] \
  && _ok "the W1 file is left as delivered; no second copy" || _bad "capture must not overwrite or duplicate a delivered file"

# ── 4. present but empty ─────────────────────────────────────────────────────
tr '\0' '\n' <"${TMP}/env.on" | grep -q '^TAILSCALE_AUTHKEY' && _bad "empty ROLE var must be unset" || _ok "present-but-empty ROLE var is unset"
[ ! -e "${TMP}/sec-on/root/TAILSCALE_AUTHKEY" ] && _ok "no file for an empty value" || _bad "empty value must not be written"

# ── 5. symlink planted at the role dir and at the file ───────────────────────
mkdir -p "${TMP}/sec-sym"; VICTIM="${TMP}/victim"; printf 'precious' >"$VICTIM"
mkdir -p "${TMP}/elsewhere"; ln -s "${TMP}/elsewhere" "${TMP}/sec-sym/ab-identity"
_run 1 "${TMP}/sec-sym" : sym >/dev/null 2>&1
[ -z "$(ls -A "${TMP}/elsewhere")" ] && [ ! -L "${TMP}/sec-sym/ab-identity" ] \
  && _ok "a symlinked role dir is replaced, not followed" || _bad "delivery followed a symlinked dir"
mkdir -p "${TMP}/sec-sym2/ab-identity"; ln -s "$VICTIM" "${TMP}/sec-sym2/ab-identity/AGENTBOX_PRIVKEY_HEX"
_run 1 "${TMP}/sec-sym2" : sym2 >/dev/null 2>&1
[ "$(cat "$VICTIM")" = precious ] && _ok "a symlinked target file is not written through" || _bad "delivery wrote through a symlink"

# ── 6. final scrub catches a re-introduced var ───────────────────────────────
OUT="$(env -i PATH="$PATH" bash -c 'set -euo pipefail; . "$1"; export AGENTBOX_NSEC=nsec1reintroduced; _ab_role_env_scrub 1; env | grep -c "^AGENTBOX_NSEC=" || true' _ "${TMP}/fns.sh" 2>&1)"
printf '%s' "$OUT" | grep -q 'ROLE-ISOLATION-LEAK AGENTBOX_NSEC' && _ok "final scrub logs ROLE-ISOLATION-LEAK by name" || _bad "leak marker missing" "$OUT"
[ "$(printf '%s' "$OUT" | tail -1)" = 0 ] && _ok "final scrub unsets it" || _bad "final scrub must unset" "$OUT"

# ── 7. devuser-class and non-secret pass through ─────────────────────────────
for kv in "BRIDGE_TOKEN=$V3" "ANTHROPIC_API_KEY=prov-synthetic" "WORKSPACE=/w"; do
  tr '\0' '\n' <"${TMP}/env.on" | grep -qxF "$kv" || { _bad "${kv%%=*} must pass through unchanged"; continue; }
  _ok "${kv%%=*} passes through unchanged under the flag"
done

# ── 8. never prints a value ──────────────────────────────────────────────────
ALL="$(_run 1 "${TMP}/sec-print" : print 2>&1; env -i PATH="$PATH" bash -c '. "$1"; export AGENTBOX_PRIVKEY_HEX='"$V1"'; _ab_role_env_scrub 1' _ "${TMP}/fns.sh" 2>&1)"
if printf '%s' "$ALL" | grep -qE "$V1|$V2|nsec1synthetic"; then _bad "a value was printed"; else _ok "names only: no value in any output"; fi

# ── 8b. the bootstrap-written relay key is handed to its role ────────────────
K="${TMP}/nostr.key"; printf 'k' >"$K"; chmod 0644 "$K"
bash -c '. "$1"; _ab_role_key_file_own 0 "$2" ab-identity' _ "${TMP}/fns.sh" "$K"
[ "$(stat -c %a "$K")" = 644 ] && _ok "flag off: the relay key file is not touched" || _bad "flag off must not chmod the key file"
bash -c '. "$1"; _ab_role_key_file_own 1 "$2" ab-identity' _ "${TMP}/fns.sh" "$K"
[ "$(stat -c %a "$K")" = 400 ] && _ok "flag on: the relay key file is 0400" || _bad "flag on must chmod 0400" "$(stat -c %a "$K")"
ln -s "$VICTIM" "${TMP}/nostr.link"; chmod 0644 "$VICTIM"
bash -c '. "$1"; _ab_role_key_file_own 1 "$2" ab-identity' _ "${TMP}/fns.sh" "${TMP}/nostr.link"
[ "$(stat -c %a "$VICTIM")" = 644 ] && _ok "a symlinked key path is not followed" || _bad "key-file ownership followed a symlink"
grep -qE '^_ab_role_key_file_own "\$AGENTBOX_ROLE_ISOLATION" "\$\{AGENTBOX_BRIDGE_SK_FILE:-\}" ab-identity' "$ENTRY" \
  && _ok "Phase 5c hands AGENTBOX_BRIDGE_SK_FILE to ab-identity" || _bad "Phase 5c must call _ab_role_key_file_own"

# ── 9. wiring ────────────────────────────────────────────────────────────────
cap="$(grep -nE '^_ab_role_env_capture "\$AGENTBOX_ROLE_ISOLATION"' "$ENTRY" | head -1 | cut -d: -f1)"
boot="$(grep -nE '^nostr-pod-bridge bootstrap' "$ENTRY" | head -1 | cut -d: -f1)"
src="$(grep -nE '^\s*\. /run/agentbox/identity\.env' "$ENTRY" | head -1 | cut -d: -f1)"
scr="$(grep -nE '^_ab_role_env_scrub "\$AGENTBOX_ROLE_ISOLATION"' "$ENTRY" | head -1 | cut -d: -f1)"
ex="$(grep -nE '^exec supervisord' "$ENTRY" | head -1 | cut -d: -f1)"
[ -n "$cap" ] && [ -n "$boot" ] && [ "$cap" -lt "$boot" ] && _ok "capture runs before the identity bootstrap (line $cap < $boot)" \
  || _bad "capture must run before nostr-pod-bridge bootstrap" "cap=${cap:-none} boot=${boot:-none}"
[ -n "$scr" ] && [ -n "$src" ] && [ -n "$ex" ] && [ "$scr" -gt "$src" ] && [ "$scr" -lt "$ex" ] \
  && { [ "$ex" -eq "$((scr + 1))" ] || [ -z "$(sed -n "$((scr + 1)),$((ex - 1))p" "$ENTRY" | grep -E '^\s*[^#[:space:]]' | grep -vE '^\s*echo ')" ]; } \
  && _ok "scrub runs after identity.env is sourced and immediately before exec supervisord" \
  || _bad "scrub must sit right before exec supervisord" "src=${src:-none} scrub=${scr:-none} exec=${ex:-none}"

# ── 9b. tailscale-up (root, the one ROLE consumer outside identity) ─────────
# Run the real supervisor command from flake.nix against a stub tailscale that
# records its argv: with the file var the key never reaches argv; flag off, the
# original branch is unchanged.
LINE="$(grep -E '^command=.*tailscale up' "${HERE}/../../flake.nix" | head -1 | sed 's/^command=//')"
if [ -z "$LINE" ]; then _bad "tailscale-up command found in flake.nix"; else
  mkdir -p "${TMP}/ts/bin"
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "%s/ts/argv"\n' "$TMP" >"${TMP}/ts/bin/tailscale"; chmod +x "${TMP}/ts/bin/tailscale"
  CMD="$(printf '%s' "$LINE" | sed -e "s|\${pkgs.bash}|$(dirname "$(command -v bash)")/..|; s|\${pkgs.tailscale}|${TMP}/ts|g; s|\${networkingCfg.hostname or \"agentbox\"}|agentbox|g; s|sleep 2|true|")"
  KEYF="${TMP}/ts/authkey"; printf 'tskey-synthetic-000' >"$KEYF"
  env -i PATH="$PATH" TAILSCALE_AUTHKEY_FILE="$KEYF" bash -c "$CMD" >/dev/null 2>&1
  if grep -qx -- "--authkey=file:${KEYF}" "${TMP}/ts/argv" 2>/dev/null && ! grep -q 'tskey-synthetic' "${TMP}/ts/argv"; then
    _ok "tailscale-up: TAILSCALE_AUTHKEY_FILE → --authkey=file:<path>; the key is not on argv"
  else _bad "tailscale-up must pass file:<path>" "$(tr '\n' ' ' <"${TMP}/ts/argv" 2>/dev/null)"; fi
  rm -f "${TMP}/ts/argv"
  env -i PATH="$PATH" TAILSCALE_AUTHKEY=tskey-legacy bash -c "$CMD" >/dev/null 2>&1
  grep -qx -- "--authkey=tskey-legacy" "${TMP}/ts/argv" 2>/dev/null \
    && _ok "tailscale-up, flag off: the original TAILSCALE_AUTHKEY branch is unchanged" || _bad "flag-off tailscale-up branch changed"
fi

# ── 10. live ─────────────────────────────────────────────────────────────────
if [ "${AGENTBOX_RC_LIVE:-0}" = 1 ] && [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ]; then
  live=""; for n in $ROLE_NAMES; do [ -n "${!n+x}" ] && live="$live $n"; done
  [ -z "$live" ] && _ok "live: this shell carries no ROLE variable" || _bad "live: ROLE vars in an agent shell" "$live"
else
  _skip "live check needs the flag on in a rebuilt image (AGENTBOX_RC_LIVE=1)"
fi

_done
