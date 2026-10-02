#!/usr/bin/env bash
# preflight-liquidity.sh — before a demo run on sidestr:dreamlab-txbt4: does the treasury and
# does each demo agent hold what the run needs, on the chain the producer is actually serving?
# Exit 0 only when every check passes. Reads public data only: the producer's /chain.json, /tip
# and /coins/<script>, the chain's checkpoints.json, and public account files ({"challenge":…}
# or {"script":…}) or bare output scripts. It refuses anything that looks like a key.
#
#   preflight-liquidity.sh [--producer URL] [--chain NAME] [--treasury ACCOUNT[=MIN]]
#                          [--agent ACCOUNT[=MIN]]... [--max-tip-age SECONDS]
#
#   ACCOUNT  a public account file (.json with challenge or script) or an output script in hex
#   MIN      sats that must be spendable now (default: treasury 25000, agent 10300)
#
# Defaults: producer http://127.0.0.1:3451, chain dreamlab-txbt4, treasury
# $WORKSPACE/sidestr/agents/treasury-dreamlab-txbt4.json, agents
# $WORKSPACE/sidestr/agents/demo-{a,b}-dreamlab-txbt4.json, tip age at most 1200 s.
#
# Why these numbers: an agent opening a Hitch session needs MIN_OPEN (10,000 sats,
# sidestr-hitch protocol) plus fees, so 10,300; the faucet grants 1,000 sats, a tenth of that, so
# demo agents are funded from the treasury, which therefore holds two openings and a margin.
# Spendable means mature: coins enter this chain only as peg-in claims in a coinbase (SPEC 2,
# no subsidy), and a coinbase coin waits 100 blocks (the sidechain's own maturity; txbt4's
# 6,705-block rule is about parent coins, not these). Immature sats are reported, not counted.
#
# It also states the anchoring plainly: no checkpoint in checkpoints.json means no block of this
# chain is anchored in txbt4 (owner SC5); the demo must say so, and this script says so first.
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PRODUCER="http://127.0.0.1:3451"
NAME="dreamlab-txbt4"
TREASURY="$WORKSPACE/sidestr/agents/treasury-$NAME.json=25000"
AGENTS=()
MAX_TIP_AGE=1200
COINBASE_MATURITY=100

die() { echo "preflight-liquidity: $*" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --producer)    PRODUCER="${2:?}"; shift 2 ;;
    --chain)       NAME="${2:?}"; shift 2 ;;
    --treasury)    TREASURY="${2:?}"; shift 2 ;;
    --agent)       AGENTS+=("${2:?}"); shift 2 ;;
    --max-tip-age) MAX_TIP_AGE="${2:?}"; shift 2 ;;
    -h|--help)     sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument $1 (see --help)" ;;
  esac
done
[ "${#AGENTS[@]}" -gt 0 ] || AGENTS=("$WORKSPACE/sidestr/agents/demo-a-$NAME.json=10300" "$WORKSPACE/sidestr/agents/demo-b-$NAME.json=10300")
DOC="$REPO/config/sidechain/$NAME/chain.json"
STATE="${SIDESTR_STATE:-$WORKSPACE/sidestr/$NAME}"
[ -r "$DOC" ] || die "no sealed document at $DOC"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

get() { curl -fsS --max-time 15 "$PRODUCER$1"; }

# account "PATH_OR_SCRIPT[=MIN]" default-min -> "script min label", or an error line
account() {
  local spec="$1" min="$2" src script
  src="${spec%%=*}"; [ "$src" != "$spec" ] && min="${spec#*=}"
  [[ "$min" =~ ^[0-9]+$ ]] || { echo "ERR minimum '$min' is not a whole number of sats"; return; }
  if [[ "$src" =~ ^(5120|0014|0020)[0-9a-f]+$ ]]; then script="$src"
  elif [[ "$src" == *.key ]]; then echo "ERR $src is a key file: pass the public account file"; return
  elif [ -r "$src" ]; then
    script="$(python3 - "$src" <<'PY'
import json, re, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("ERR not a JSON account file"); sys.exit()
if not isinstance(d, dict):
    print("ERR not a JSON account file"); sys.exit()
# a key-like field may name a key file (a path); it must not hold a key
material = lambda v: isinstance(v, str) and (re.fullmatch(r"[0-9a-fA-F]{64}", v.strip()) or v.strip().startswith("nsec1"))
if any(material(v) for n, v in d.items() if n != "pubkey" and re.search("key|secret|nsec|priv|seed", n, re.I)):
    print("ERR the file holds key material; pass a public account file"); sys.exit()
s = d.get("challenge") or d.get("script") or ""
print(s if re.fullmatch(r"(5120|0014|0020)[0-9a-f]+", s) else "ERR no challenge/script output script in the file")
PY
)"
    [[ "$script" == ERR* ]] && { echo "$script ($src)"; return; }
  else echo "ERR no account file at $src"; return
  fi
  echo "$script $min $(basename "$src")"
}

echo "pre-flight: sidestr:$NAME via $PRODUCER"

# 1. the producer serves the sealed chain, and is alive
served="$(get /chain.json 2>/dev/null || true)"
if [ -z "$served" ]; then bad "the producer answers at $PRODUCER"; echo; echo "passed $pass, failed $fail"; exit 1; fi
want_id="$(jq -r .id "$DOC")"; want_gen="$(jq -r .genesisHash "$DOC")"
if [ "$(jq -r .id <<<"$served")" = "$want_id" ] && [ "$(jq -r .genesisHash <<<"$served")" = "$want_gen" ]; then
  ok "producer serves $want_id, genesis ${want_gen:0:16}… (the committed document)"
else bad "producer serves $(jq -r .id <<<"$served") genesis $(jq -r .genesisHash <<<"$served"), not $want_id ${want_gen:0:16}…"; fi
tip="$(get /tip)"; height="$(jq -r .height <<<"$tip")"; age=$(( $(date +%s) - $(jq -r .time <<<"$tip") ))
if [ "$age" -le "$MAX_TIP_AGE" ]; then ok "tip $height, ${age} s old (≤ $MAX_TIP_AGE)"
else bad "tip $height is ${age} s old (> $MAX_TIP_AGE): a wedged producer looks RUNNING to supervisord"; fi

# 2. anchoring, stated before any balance
anchored="$(jq -r '[.checkpoints[]? | select(.parentTxid != null)] | last | if . == null then "" else "\(.height) \(.parentTxid)" end' "$STATE/checkpoints.json" 2>/dev/null || true)"
if [ -n "$anchored" ]; then echo "  note anchored: last checkpoint at height ${anchored%% *}, $(jq -r .parent "$DOC") tx ${anchored#* }"
else echo "  note NOT ANCHORED: no checkpoint of sidestr:$NAME exists in $(jq -r .parent "$DOC") (checkpoints are off; for txbt4 that is owner decision SC5). Every block is the single signer's word; the demo must say so."; fi

# 3. balances: spendable (mature) sats per account
check_account() { # role spec default-min
  local role="$1" line script min label coins spendable immature
  line="$(account "$2" "$3")"
  if [[ "$line" == ERR* ]]; then bad "$role: ${line#ERR }"; return; fi
  read -r script min label <<<"$line"
  coins="$(get "/coins/$script")" || { bad "$role ($label): /coins refused"; return; }
  read -r spendable immature < <(jq -r --argjson tip "$height" --argjson m "$COINBASE_MATURITY" '
    [ .[] | select((.coinbase | not) or ($tip + 1 - .height >= $m)) | .value ] as $s
    | [ .[] | select(.coinbase and ($tip + 1 - .height < $m)) | .value ] as $i
    | "\($s | add // 0) \($i | add // 0)"' <<<"$coins")
  local extra=""; [ "$immature" -gt 0 ] && extra=", $immature more maturing"
  if [ "$spendable" -ge "$min" ]; then ok "$role ($label): $spendable sats spendable ≥ $min$extra"
  else bad "$role ($label): $spendable sats spendable < $min needed$extra"; fi
}
check_account treasury "$TREASURY" 25000
i=0; for a in "${AGENTS[@]}"; do i=$((i+1)); check_account "agent $i" "$a" 10300; done

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
