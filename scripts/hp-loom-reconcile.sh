#!/usr/bin/env bash
# hp-loom-reconcile.sh — ADR-2140. Check the HP Loom against the vault, and bring it up to date.
#
# The vault (the visionGraph repository, [vault].repo) is canonical HERE. The HP never reads it.
# It serves a built generation, `visionGraph@<sha>`, and this script is the one publisher:
# it automates the documented pipeline (loom docs/published-generation-reload.md) and nothing else.
#
#   check    compare the committed HEAD with the generation the Loom serves; touch nothing
#   full     if they differ: build HEAD from a clean detached worktree (so uncommitted edits can
#            never be served), promote + verify the bundle, push it to the HP under the
#            in-flight marker, start the HP's own verifying reload, and wait for the Loom to
#            serve the new id. If they agree it does nothing at all (no Loom recreate).
#   off      do nothing
#
# Fail-open: every problem (HP unreachable, a tool missing, a verify refusal) is recorded in the
# receipt and exits 0, so it can run from the boot path without ever stopping a container. Use
# --strict to get a non-zero exit for a state that is not current/off/reloaded.
#
#   --mode check|full   default $HP_LOOM_SYNC, else check
#   --force             in full mode, publish even when the Loom already serves HEAD (used to
#                       exercise the whole remote path against a scratch LOOM_HP_DIR)
#   --strict            exit 1 unless the final state is current, off or reloaded
#   --json              print the receipt on stdout as well
#
# Receipt: $STATE_DIR/hp-loom-reconcile.json (atomic write). Lock: one run at a time.
#
# Environment (all optional; the entrypoint exports the first three from [vault]):
#   VAULT_REPO      the vault repository (required)
#   LOOM_URL        the Loom door ([vault].loom_url), required
#   LOOM_HP_HOST    ssh target for the HP ([vault].loom_host), required for full
#   LOOM_HP_DIR     the loom checkout on the HP relative to $HOME, default githubs/loom
#   LOOM_HP_BIN     where the HP's own reload_published_generation lives, relative to $HOME,
#                   default githubs/loom/target/release (independent of LOOM_HP_DIR)
#   LOOM_BIN_DIR    holds promote_vault_build and reload_published_generation
#   ONTOMARK_BIN    the ontomark CLI; default /opt/agentbox/bin/ontomark, else `ontomark` on PATH
#   PUBLISH_DIR     build scratch, default $HOME/workspace/loom-publish
#   STATE_DIR       receipt + lock, default $HOME/.local/state/agentbox
#   SSH_BIN         default ssh (tests substitute a stub)
#   BUILD_TIMEOUT / SHIP_TIMEOUT / RELOAD_WAIT   seconds: 900 / 300 / 90
set -uo pipefail

MODE="${HP_LOOM_SYNC:-check}"; STRICT=0; JSON=0; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    --force) FORCE=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "hp-loom-reconcile: unknown flag: $1" >&2; exit 2 ;;
  esac
done
case "$MODE" in off|check|full) ;; *) echo "hp-loom-reconcile: --mode must be off, check or full (got: $MODE)" >&2; exit 2 ;; esac

REPO="${VAULT_REPO:-}"
LOOM_URL="${LOOM_URL:-}"
HOST="${LOOM_HP_HOST:-}"
HPDIR="${LOOM_HP_DIR:-githubs/loom}"
HPBIN="${LOOM_HP_BIN:-githubs/loom/target/release}"
BIN_DIR="${LOOM_BIN_DIR:-$HOME/workspace/loom/target/release}"
# ontomark: an explicit ONTOMARK_BIN wins; else the baked, rebuild-stable /opt/agentbox/bin/ontomark
# (the boot path's PATH need not include it); else whatever is on PATH.
if [ -n "${ONTOMARK_BIN:-}" ]; then ONTOMARK="$ONTOMARK_BIN"
elif [ -x /opt/agentbox/bin/ontomark ]; then ONTOMARK=/opt/agentbox/bin/ontomark
else ONTOMARK=ontomark; fi
PUBLISH="${PUBLISH_DIR:-$HOME/workspace/loom-publish}"
STATE="${STATE_DIR:-$HOME/.local/state/agentbox}"
SSH="${SSH_BIN:-ssh}"
BUILD_TIMEOUT="${BUILD_TIMEOUT:-900}"; SHIP_TIMEOUT="${SHIP_TIMEOUT:-300}"; RELOAD_WAIT="${RELOAD_WAIT:-90}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

mkdir -p "$STATE"
RECEIPT="$STATE/hp-loom-reconcile.json"
HEAD_SHA="" SERVED="" DIRTY=0 STATE_NAME="" DETAIL="" STEPS=()

step() { STEPS+=("$1"); }
finish() { # <state> <detail>
  STATE_NAME="$1"; DETAIL="${2:-}"
  local tmp; tmp="$(mktemp "$STATE/.receipt.XXXXXX")"
  jq -n --arg ts "$(date -u +%FT%TZ)" --arg mode "$MODE" --arg state "$STATE_NAME" --arg detail "$DETAIL" \
        --arg head "$HEAD_SHA" --arg served "$SERVED" --argjson dirty "$DIRTY" --arg host "$HOST" \
        --arg steps "${STEPS[*]:-}" \
     '{ts:$ts, mode:$mode, state:$state, detail:$detail, vault_head:$head, served:$served,
       vault_uncommitted_files:$dirty, hp_host:$host, steps:($steps|split(" ")|map(select(length>0)))}' > "$tmp" \
     && mv "$tmp" "$RECEIPT"
  echo "hp-loom-reconcile: $STATE_NAME${DETAIL:+ — $DETAIL}" >&2
  [ "$JSON" = 1 ] && cat "$RECEIPT"
  case "$STATE_NAME" in current|off|reloaded) exit 0 ;; *) [ "$STRICT" = 1 ] && exit 1; exit 0 ;; esac
}

[ "$MODE" = off ] && finish off "HP_LOOM_SYNC=off"
for t in jq git curl; do command -v "$t" >/dev/null 2>&1 || finish degraded "$t is not installed"; done
[ -n "$REPO" ] && [ -e "$REPO/.git" ] || finish degraded "VAULT_REPO is not a git repository: ${REPO:-unset}"
[ -n "$LOOM_URL" ] || finish degraded "LOOM_URL ([vault].loom_url) is not set"

exec 9>"$STATE/hp-loom-reconcile.lock"
command -v flock >/dev/null 2>&1 && ! flock -n 9 && finish busy "another reconcile holds the lock"

HEAD_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || finish degraded "cannot read the vault HEAD"
SHORT="${HEAD_SHA:0:9}"
DIRTY="$(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
step probe

# Only a settled commit is ever published: not a detached HEAD, not mid-rebase/merge/cherry-pick.
settled() {
  git -C "$REPO" symbolic-ref -q HEAD >/dev/null 2>&1 || { UNSETTLED="HEAD is detached"; return 1; }
  local f gd
  gd="$(git -C "$REPO" rev-parse --absolute-git-dir 2>/dev/null)" || { UNSETTLED="cannot locate the git directory"; return 1; }
  for f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
    [ -e "$gd/$f" ] && { UNSETTLED="a ${f%%_HEAD} is in progress"; return 1; }
  done
  return 0
}
UNSETTLED=''

served_id() { curl -fsS -m 8 "$LOOM_URL/loom/generation" 2>/dev/null | jq -r '.id // .generation.id // empty' 2>/dev/null; }
SERVED="$(served_id)"
[ -n "$SERVED" ] || finish unreachable "the Loom at $LOOM_URL did not answer /loom/generation"
[ "$SERVED" = "visionGraph@$HEAD_SHA" ] && { [ "$FORCE" = 1 ] && [ "$MODE" = full ] || finish current "serving the committed HEAD ($SHORT)"; }
[ "$MODE" = check ] && finish stale "serving ${SERVED#visionGraph@} but the vault HEAD is $HEAD_SHA (mode check: nothing changed)"

# ── full: tools first, so a missing one is a clean degraded result and not a half-run ──────────
[ -n "$HOST" ] || finish degraded "LOOM_HP_HOST ([vault].loom_host) is not set"
command -v "$ONTOMARK" >/dev/null 2>&1 || [ -x "$ONTOMARK" ] || finish degraded "ontomark not found ($ONTOMARK)"
PROMOTE="$BIN_DIR/promote_vault_build"; VERIFY="$BIN_DIR/reload_published_generation"
[ -x "$PROMOTE" ] && [ -x "$VERIFY" ] || finish degraded "promote_vault_build / reload_published_generation not found in $BIN_DIR (cargo build --release -p loom-vector-ruvector --bin promote_vault_build; -p loom-facade --bin reload_published_generation)"
command -v tar >/dev/null 2>&1 || finish degraded "tar is not installed"
timeout 15 "$SSH" "${SSH_OPTS[@]}" "$HOST" true >/dev/null 2>&1 || finish unreachable "cannot ssh to $HOST"
step tools

settled || finish deferred "not publishing an unsettled vault: $UNSETTLED"

# ── build: a clean DETACHED worktree at the committed HEAD, never the live tree ───────────────
OUT="$PUBLISH/$SHORT"; WT="$PUBLISH/wt-$SHORT"
mkdir -p "$PUBLISH"
verified_here() { "$VERIFY" verify --data-dir "$OUT/data" 2>/dev/null | jq -r '.generation // empty' 2>/dev/null; }
if [ "$(verified_here)" = "visionGraph@$HEAD_SHA" ]; then
  step build-reused
else
  git -C "$REPO" worktree prune 2>/dev/null
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null; rm -rf "$WT" "$OUT"
  git -C "$REPO" worktree add -q --detach "$WT" "$HEAD_SHA" || finish failed "could not create the snapshot worktree"
  # The vault's own gate: nothing with validation errors reaches every agent's grounding.
  if ! timeout 300 "$ONTOMARK" --repo "$WT" validate --vault all >"$PUBLISH/validate-$SHORT.log" 2>&1; then
    git -C "$REPO" worktree remove --force "$WT" 2>/dev/null; rm -rf "$WT"
    finish refused "ontomark validate --vault all reports errors at $SHORT (log: $PUBLISH/validate-$SHORT.log); nothing built or sent"
  fi
  step validate
  timeout "$BUILD_TIMEOUT" "$ONTOMARK" --repo "$WT" build --out "$OUT" --with-rvdb --stats >"$PUBLISH/build-$SHORT.log" 2>&1
  rc=$?
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null; rm -rf "$WT"
  [ "$rc" -eq 0 ] || finish failed "ontomark build exited $rc (log: $PUBLISH/build-$SHORT.log)"
  step build
  timeout 300 "$PROMOTE" --data "$OUT/data" >"$PUBLISH/promote-$SHORT.log" 2>&1 \
    || finish failed "promote_vault_build refused the bundle (log: $PUBLISH/promote-$SHORT.log)"
  step promote
  [ "$(verified_here)" = "visionGraph@$HEAD_SHA" ] || finish failed "the built bundle does not verify as visionGraph@$HEAD_SHA"
  step verify
fi

# ── ship: stream, then swap under the in-flight marker. The HP login shell is fish, so the ───
# remote commands avoid shell variables and the swap script is fed to `bash -s` on stdin.
DEST="$HPDIR/data.$SHORT"
tar -C "$OUT/data" -cf - . | timeout "$SHIP_TIMEOUT" "$SSH" "${SSH_OPTS[@]}" "$HOST" \
  "bash -c 'rm -rf $DEST && mkdir -p $DEST && tar -C $DEST -xf -'" >/dev/null 2>&1 \
  || finish failed "streaming the bundle to $HOST:$DEST failed"
step ship

# The HP verifies the bundle with ITS OWN binary before anything is swapped: the container's copy
# proves the build, not what the HP's reload timer will accept after transfer. No jq is assumed.
timeout 120 "$SSH" "${SSH_OPTS[@]}" "$HOST" bash -s >/dev/null 2>&1 <<REMOTE
cd "\$HOME/$HPDIR" || exit 5
[ -f "data.$SHORT/.generation.json" ] || { rm -rf "data.$SHORT"; exit 3; }
out=\$("\$HOME/$HPBIN/reload_published_generation" verify --data-dir "data.$SHORT" 2>/dev/null) || { rm -rf "data.$SHORT"; exit 4; }
case "\$out" in *'"generation":"visionGraph@$HEAD_SHA"'*) exit 0 ;; *) rm -rf "data.$SHORT"; exit 4 ;; esac
REMOTE
rc=$?
[ "$rc" -eq 0 ] || finish failed "the HP's own verify refused the uploaded bundle (exit $rc); nothing was swapped"
step hp-verify

timeout "$SHIP_TIMEOUT" "$SSH" "${SSH_OPTS[@]}" "$HOST" bash -s >/dev/null 2>&1 <<REMOTE
set -e
cd "\$HOME/$HPDIR"
rm -rf data.rollback; cp -a data data.rollback            # previous generation + ledger
touch data/.promotion-in-flight
restore() { rsync -a data.rollback/ data/; rm -f data/.promotion-in-flight; }
trap restore ERR
rsync -a --exclude .generation.json "data.$SHORT/" data/    # never --delete: data/ holds ledger.jsonl
cp "data.$SHORT/.generation.json" data/.generation.json.new
mv data/.generation.json.new data/.generation.json
trap - ERR
rm -f data/.promotion-in-flight
rm -rf "data.$SHORT"
REMOTE
[ $? -eq 0 ] || finish failed "the swap on $HOST failed; the previous generation was restored from data.rollback"
step swap

# ── reload: the HP's own verifying oneshot, then wait for the Loom to serve the new id ────────
timeout 170 "$SSH" "${SSH_OPTS[@]}" "$HOST" systemctl --user start loom-generation-reload.service >/dev/null 2>&1
rc=$?
step reload
if [ "$rc" -ne 0 ]; then
  hp_receipt="$(timeout 15 "$SSH" "${SSH_OPTS[@]}" "$HOST" cat .local/state/loom/reload.json 2>/dev/null | tr -d '\n' | cut -c1-300)"
  finish failed "the HP reload service exited $rc after the swap; the HP receipt says: ${hp_receipt:-unreadable}"
fi
waited=0
while [ "$waited" -lt "$RELOAD_WAIT" ]; do
  SERVED="$(served_id)"
  [ "$SERVED" = "visionGraph@$HEAD_SHA" ] && finish reloaded "now serving $SHORT"
  sleep 3; waited=$((waited + 3))
done
finish shipped "bundle is on $HOST; the Loom still serves ${SERVED#visionGraph@}. The HP reload timer will retry within 5 minutes"
