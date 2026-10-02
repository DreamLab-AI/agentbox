#!/usr/bin/env bash
# dell-txbt4-open-rpc.sh — give sidestr:dreamlab-txbt4's producer its own RPC user on the Dell's
# BLAKE2b testnet4 node (Knots 29.4.2, knots-txbt4.service, /etc/knots/txbt4.conf), LAN only.
# ADR-2103 (the txbt4 seal, 2026-10-02); config/sidechain/README.md.
#
# Three steps, in two places. The password is made where it is used (the agentbox secrets
# volume) and never leaves it; only the rpcauth verifier (user:salt$HMAC-SHA256) crosses to the
# Dell, which is what Knots stores anyway.
#
#   1. agentbox:  dell-txbt4-open-rpc.sh mint   [--user sidestrtxbt4] [--out FILE]
#        writes FILE (user:password, 0600; default /var/lib/agentbox/secrets/sidestr-txbt4.rpc)
#        and FILE.rpcauth (the verifier), then prints the verifier. Run again: reuses both.
#   2. the Dell:  sudo dell-txbt4-open-rpc.sh apply --rpcauth 'user:salt$hash' [--with-checkpoint-wallet] [--yes]
#        as the admin user ON 192.168.2.27. Makes sure txbt4.conf binds the LAN address, allows
#        192.168.2.0/24, keeps rpcwhitelistdefault=0, and carries this user's rpcauth and a method
#        whitelist; makes sure nftables admits 192.168.2.0/24 to tcp/48342 (live and persisted).
#        Prints the diff and asks before changing anything. Restarts knots-txbt4.service only,
#        then verifies; on a failed restart it restores the old config and restarts again.
#        Idempotent: with everything in place it changes nothing and restarts nothing.
#   3. agentbox:  dell-txbt4-open-rpc.sh verify [--cred FILE]
#        over the LAN with the new user: the fork hash at 150,308, decoderawtransaction allowed,
#        getpeerinfo refused (the whitelist holds). Then point [sidechain.dreamlab-txbt4]
#        parent_credential_file at FILE.
#
# What apply never touches: the mainnet bitcoind, Core Lightning (a live real-money channel) and
# rbitcoin-txbt4. It restarts one named unit, and it checks before and after that every other
# bitcoin/lightning/rbitcoin unit kept its start time, failing loudly if one did not.
set -euo pipefail

DELL_IP=192.168.2.27
LAN=192.168.2.0/24
PORT=48342
UNIT=knots-txbt4.service
CONF=/etc/knots/txbt4.conf
NFT_CONF=/etc/nftables.conf
FORK_HEIGHT=150308
FORK_HASH=000000000000b9d1b7e1bb0e77215ee92c6ef7ec8f4473e23908380649e779b6
DEFAULT_USER=sidestrtxbt4
DEFAULT_OUT=/var/lib/agentbox/secrets/sidestr-txbt4.rpc
# What the producer calls without a wallet (siding/lib/parent.mjs, bin/siding.mjs at the pinned
# spec commit): the peg-in scan and claim, and judging parent transactions relayed over kind
# 23503 by the node's own policy. Plus read-only health calls for verification.
METHODS_READ=getblockchaininfo,getbestblockhash,getblockcount,getblockhash,getblock,getblockheader,gettxout,getrawtransaction,decoderawtransaction,testmempoolaccept,sendrawtransaction,getmempoolinfo,uptime
# Checkpoints (SPEC 11, siding/lib/checkpoint.mjs) from a fee wallet, only once the owner switches
# them on (ADR-2103 Open, SC5).
METHODS_CHECKPOINT=send,gettransaction,listtransactions

die()  { echo "dell-txbt4-open-rpc: $*" >&2; exit 1; }
note() { echo "dell-txbt4-open-rpc: $*" >&2; }

usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ── 1. mint (agentbox) ──────────────────────────────────────────────────────────────────
cmd_mint() {
  local user="$DEFAULT_USER" out="$DEFAULT_OUT"
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:?}"; shift 2 ;;
      --out)  out="${2:?}"; shift 2 ;;
      *) usage 2 ;;
    esac
  done
  [[ "$user" =~ ^[a-z][a-z0-9]{2,31}$ ]] || die "a user name is 3-32 lower-case letters and digits"
  if [ -e "$out" ] && [ -e "$out.rpcauth" ]; then
    [ "$(cut -d: -f1 "$out")" = "$user" ] || die "$out belongs to another user; pick another --out"
    note "reusing $out (its verifier is $out.rpcauth)"
  else
    [ -e "$out" ] && die "$out exists without $out.rpcauth; move it aside or pass another --out"
    umask 077
    mkdir -p "$(dirname "$out")"
    # The same construction as Bitcoin Core's share/rpcauth/rpcauth.py: a 16-byte hex salt and
    # HMAC-SHA256(key = salt, message = password), from Python's standard secrets and hmac.
    python3 - "$user" "$out" <<'PY'
import hmac, os, secrets, sys
user, out = sys.argv[1], sys.argv[2]
password = secrets.token_urlsafe(32)
salt = secrets.token_hex(16)
verifier = hmac.new(salt.encode(), password.encode(), "sha256").hexdigest()
for path, text in ((out, f"{user}:{password}\n"), (out + ".rpcauth", f"{user}:{salt}${verifier}\n")):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
PY
    note "wrote $out (0600, user:password) and $out.rpcauth"
  fi
  echo
  echo "On the Dell, as admin (the verifier is not a secret; the password stays here):"
  echo "  sudo bash dell-txbt4-open-rpc.sh apply --rpcauth '$(cat "$out.rpcauth")'"
}

# ── 3. verify (agentbox) ────────────────────────────────────────────────────────────────
rpc_call() { # url credfile method params-json -> HTTP status and body on stdout, status last
  curl -sS --max-time 20 -u "$(cat "$2")" -H 'content-type: text/plain' -o /dev/stdout -w '\n%{http_code}' \
    --data "{\"jsonrpc\":\"1.0\",\"id\":\"verify\",\"method\":\"$3\",\"params\":$4}" "$1"
}
cmd_verify() {
  local cred="$DEFAULT_OUT" url="http://$DELL_IP:$PORT/" fails=0 out status body
  while [ $# -gt 0 ]; do
    case "$1" in
      --cred) cred="${2:?}"; shift 2 ;;
      --url)  url="${2:?}"; shift 2 ;;
      *) usage 2 ;;
    esac
  done
  [ -r "$cred" ] || die "no credential at $cred (run mint first)"
  check() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fails=$((fails+1)); fi; }
  out="$(rpc_call "$url" "$cred" getblockhash "[$FORK_HEIGHT]")"; status="${out##*$'\n'}"; body="${out%$'\n'*}"
  check "getblockhash $FORK_HEIGHT is the txbt4 fork hash" '[ "$status" = 200 ] && printf "%s" "$body" | grep -q "\"$FORK_HASH\""'
  out="$(rpc_call "$url" "$cred" decoderawtransaction '["00"]')"; status="${out##*$'\n'}"
  # whitelisted: the node answers (a decode error is HTTP 500 with a JSON error); refused: 403
  check "decoderawtransaction is on the whitelist (HTTP $status, not 403)" '[ "$status" != 403 ] && [ "$status" != 401 ]'
  out="$(rpc_call "$url" "$cred" getpeerinfo '[]')"; status="${out##*$'\n'}"
  check "getpeerinfo is refused by the whitelist (HTTP $status)" '[ "$status" = 403 ]'
  [ "$fails" -eq 0 ] || die "$fails check(s) failed"
  echo "verified: set [sidechain.dreamlab-txbt4].parent_credential_file = \"$cred\" in agentbox.toml"
}

# ── 2. apply (the Dell) ─────────────────────────────────────────────────────────────────
other_units() { # every bitcoin/lightning/rbitcoin unit that is not ours, with its start time
  systemctl list-units --all --type=service --no-legend --plain 2>/dev/null | awk '{print $1}' \
    | grep -Ei 'bitcoin|lightning|clightning|cln|rbitcoin|knots' | grep -vx "$UNIT" | sort \
    | while read -r u; do echo "$u $(systemctl show -p ActiveEnterTimestampMonotonic --value "$u")"; done
}

# desired_conf <current conf> <rpcauth line> <whitelist> -> the conf with every line in place
desired_conf() {
  python3 - "$1" "$2" "$3" "$DELL_IP" "$LAN" <<'PY'
import sys
path, rpcauth, whitelist, ip, lan = sys.argv[1:6]
user = rpcauth.split(":", 1)[0]
lines = open(path).read().splitlines()
want = {f"rpcbind={ip}", f"rpcallowip={lan}", "rpcwhitelistdefault=0",
        f"rpcauth={rpcauth}", f"rpcwhitelist={user}:{whitelist}"}
# one rpcauth and one rpcwhitelist per user: Knots intersects repeated whitelists, so a second
# line would silently narrow the first; an old verifier for this user is a rotation, replaced
out = []
for l in lines:
    s = l.strip()
    if (s.startswith(f"rpcauth={user}:") or s.startswith(f"rpcwhitelist={user}:")) and s not in want:
        continue
    if s.startswith("rpcwhitelistdefault=") and s != "rpcwhitelistdefault=0":
        continue
    out.append(l)
present = {l.strip() for l in out}
missing = [w for w in ("rpcbind=" + ip, "rpcallowip=" + lan, "rpcwhitelistdefault=0",
                       "rpcauth=" + rpcauth, f"rpcwhitelist={user}:{whitelist}") if w not in present]
if missing:
    # options read under [testnet4] apply to this chain=testnet4 node; a repeated section header
    # is legal in Bitcoin's config format, so the block stands on its own
    out += ["", "[testnet4]", "# dell-txbt4-open-rpc.sh: sidestr:dreamlab-txbt4 producer (agentbox ADR-2103)"] + missing
print("\n".join(out))
PY
}

cmd_apply() {
  local rpcauth="" yes=0 checkpoint=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --rpcauth) rpcauth="${2:?}"; shift 2 ;;
      --with-checkpoint-wallet) checkpoint=1; shift ;;
      --yes) yes=1; shift ;;
      *) usage 2 ;;
    esac
  done
  [[ "$rpcauth" =~ ^[a-z][a-z0-9]{2,31}:[0-9a-f]{32}\$[0-9a-f]{64}$ ]] \
    || die "--rpcauth wants the line mint printed: user:<32 hex salt>\$<64 hex HMAC>"
  if [ "$(id -u)" != 0 ]; then exec sudo -- bash "$0" apply "$@" --rpcauth "$rpcauth" $([ "$yes" = 1 ] && echo --yes) $([ "$checkpoint" = 1 ] && echo --with-checkpoint-wallet); fi
  local user="${rpcauth%%:*}" whitelist="$METHODS_READ"
  [ "$checkpoint" = 1 ] && whitelist="$whitelist,$METHODS_CHECKPOINT"
  for t in python3 curl nft systemctl ss diff; do command -v "$t" >/dev/null || die "$t is not installed"; done
  ip -4 -o addr show | grep -q " $DELL_IP/" || die "this host does not hold $DELL_IP; run apply on the Dell (tab5)"
  systemctl cat "$UNIT" >/dev/null 2>&1 || die "$UNIT is not installed here"
  [ -f "$CONF" ] || die "$CONF is missing"
  grep -qE '^\s*chain\s*=\s*testnet4\s*$' "$CONF" || die "$CONF does not say chain=testnet4; refusing to guess which node this is"

  local work; work="$(mktemp -d)"; trap 'rm -rf "$work"' RETURN
  desired_conf "$CONF" "$rpcauth" "$whitelist" >"$work/txbt4.conf"

  # nftables: the rule admitting the LAN to $PORT, live and in $NFT_CONF, placed beside the
  # existing 48332 (tbtc4 RPC) rule so it lands in the same table and chain
  local nft_live=1 nft_file=1 anchor_line="" family="" table="" chain="" handle="" ruleset
  # captured, not piped into grep -q: under pipefail an early-closing grep can fail the pipeline
  ruleset="$(nft -a list ruleset)"
  grep -Eq "ip saddr $LAN tcp dport $PORT accept" <<<"$ruleset" || nft_live=0
  grep -Eq "ip saddr $LAN tcp dport $PORT accept" "$NFT_CONF" || nft_file=0
  cp "$NFT_CONF" "$work/nftables.conf"
  if [ "$nft_file" = 0 ]; then
    anchor_line="$(grep -nE 'tcp dport 48332 .*accept' "$NFT_CONF" | head -1 | cut -d: -f1)"
    [ -n "$anchor_line" ] || die "no 48332 rule in $NFT_CONF to place the $PORT rule beside; add 'ip saddr $LAN tcp dport $PORT accept' to the input chain by hand"
    awk -v n="$anchor_line" -v rule="ip saddr $LAN tcp dport $PORT accept" \
      'NR == n { print; match($0, /^[ \t]*/); print substr($0, 1, RLENGTH) rule; next } { print }' \
      "$NFT_CONF" >"$work/nftables.conf"
    nft -c -f "$work/nftables.conf" || die "the edited $NFT_CONF does not parse; nothing changed"
  fi
  if [ "$nft_live" = 0 ]; then
    read -r family table chain handle < <(awk '
      /^table / { fam = $2; tab = $3 } /^[ \t]*chain / { ch = $2 }
      /tcp dport 48332 .*accept/ { for (i = 1; i <= NF; i++) if ($i == "handle") { print fam, tab, ch, $(i + 1); exit } }' <<<"$ruleset") || true
    [ -n "$handle" ] || die "no live 48332 rule to place the $PORT rule beside"
  fi

  local conf_same=0
  diff -q "$CONF" "$work/txbt4.conf" >/dev/null && conf_same=1
  if [ "$conf_same" = 1 ] && [ "$nft_live" = 1 ] && [ "$nft_file" = 1 ]; then
    note "already in place: $CONF, live nftables and $NFT_CONF; nothing to do, nothing restarted"
    return 0
  fi

  echo "── planned changes on $(hostname) ──"
  [ "$conf_same" = 1 ] || diff -u --label "$CONF (now)" --label "$CONF (after)" "$CONF" "$work/txbt4.conf" | sed -E 's/(rpcauth=[a-z0-9]+:[0-9a-f]{32}\$)[0-9a-f]{64}/\1<verifier>/' || true
  [ "$nft_file" = 1 ] || diff -u --label "$NFT_CONF (now)" --label "$NFT_CONF (after)" "$NFT_CONF" "$work/nftables.conf" || true
  [ "$nft_live" = 1 ] || echo "live: nft add rule $family $table $chain position $handle ip saddr $LAN tcp dport $PORT accept"
  [ "$conf_same" = 1 ] || echo "then: systemctl restart $UNIT   (only this unit; rbitcoin-txbt4 re-peers by itself)"
  if [ "$yes" != 1 ]; then
    local answer; read -r -p "Apply these changes? [y/N] " answer
    [[ "$answer" =~ ^[yY]$ ]] || { note "nothing changed"; return 1; }
  fi

  local stamp before; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  before="$(other_units)"
  if [ "$nft_file" = 0 ]; then
    cp -p "$NFT_CONF" "$NFT_CONF.bak-$stamp"
    install -m "$(stat -c %a "$NFT_CONF")" -o "$(stat -c %u "$NFT_CONF")" -g "$(stat -c %g "$NFT_CONF")" "$work/nftables.conf" "$NFT_CONF"
    note "persisted the $PORT rule in $NFT_CONF (backup $NFT_CONF.bak-$stamp)"
  fi
  if [ "$nft_live" = 0 ]; then
    nft add rule "$family" "$table" "$chain" position "$handle" ip saddr "$LAN" tcp dport "$PORT" accept
    note "added the live rule to $family $table $chain"
  fi
  if [ "$conf_same" = 0 ]; then
    cp -p "$CONF" "$CONF.bak-$stamp"
    install -m "$(stat -c %a "$CONF")" -o "$(stat -c %u "$CONF")" -g "$(stat -c %g "$CONF")" "$work/txbt4.conf" "$CONF"
    note "wrote $CONF (backup $CONF.bak-$stamp); restarting $UNIT"
    systemctl restart "$UNIT"
    if ! wait_rpc; then
      note "$UNIT did not answer after the restart; restoring $CONF.bak-$stamp and restarting it again"
      cp -p "$CONF.bak-$stamp" "$CONF"; systemctl restart "$UNIT"
      wait_rpc || note "$UNIT still not answering on the old config: journalctl -u $UNIT"
      die "rolled back; nothing else was changed by the restart"
    fi
  fi

  # verify, from this host: the unit, the LAN listener, the fork hash, and nobody else restarted
  local after fails=0
  after="$(other_units)"
  systemctl is-active --quiet "$UNIT" && echo "  ok   $UNIT is active" || { echo "  FAIL $UNIT is not active"; fails=$((fails+1)); }
  grep -q "$DELL_IP:$PORT" <<<"$(ss -ltn)" && echo "  ok   listening on $DELL_IP:$PORT" || { echo "  FAIL not listening on $DELL_IP:$PORT"; fails=$((fails+1)); }
  [ "$(cookie_rpc getblockhash "[$FORK_HEIGHT]")" = "$FORK_HASH" ] && echo "  ok   block $FORK_HEIGHT is the txbt4 fork hash" || { echo "  FAIL block $FORK_HEIGHT is not the fork hash"; fails=$((fails+1)); }
  grep -Eq "ip saddr $LAN tcp dport $PORT accept" <<<"$(nft list ruleset)" && echo "  ok   nftables admits $LAN to $PORT" || { echo "  FAIL no live nftables rule for $PORT"; fails=$((fails+1)); }
  if [ "$before" = "$after" ]; then echo "  ok   no other bitcoin/lightning/rbitcoin unit restarted"
  else echo "  FAIL another unit's start time changed:"; diff <(echo "$before") <(echo "$after") || true; fails=$((fails+1)); fi
  systemctl is-active --quiet rbitcoin-txbt4.service 2>/dev/null && echo "  ok   rbitcoin-txbt4 is active (it re-peers on its own)" || echo "  note rbitcoin-txbt4 is not active (not touched by this script)"
  [ "$fails" -eq 0 ] || die "$fails check(s) failed"
  echo "done. Back in the agentbox: dell-txbt4-open-rpc.sh verify"
}

# the node's own cookie, read as root, against loopback: the unrestricted local user
cookie_rpc() {
  local datadir cookie
  datadir="$(sed -nE 's/^\s*datadir\s*=\s*(.+)$/\1/p' "$CONF" | tail -1)"
  [ -n "$datadir" ] || datadir="$(systemctl show -p ExecStart --value "$UNIT" | grep -oE -- '-datadir=[^ ;]+' | head -1 | cut -d= -f2)"
  cookie="${datadir:-/mnt/staging/knots-txbt4}/testnet4/.cookie"
  [ -r "$cookie" ] || return 1
  curl -sS --max-time 10 -u "$(cat "$cookie")" -H 'content-type: text/plain' \
    --data "{\"jsonrpc\":\"1.0\",\"id\":\"apply\",\"method\":\"$1\",\"params\":$2}" "http://127.0.0.1:$PORT/" \
    | python3 -c 'import json, sys; r = json.load(sys.stdin); print(r["result"] if r.get("error") is None else "")'
}
wait_rpc() {
  local i
  for i in $(seq 60); do
    [ -n "$(cookie_rpc getblockcount '[]' 2>/dev/null)" ] && return 0
    sleep 2
  done
  return 1
}

case "${1:-}" in
  mint)   shift; cmd_mint "$@" ;;
  apply)  shift; cmd_apply "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  -h|--help|help) usage 0 ;;
  *) usage 2 ;;
esac
