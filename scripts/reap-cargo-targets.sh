#!/usr/bin/env bash
# reap-cargo-targets.sh — reclaim runaway / stale Rust `target/` build caches in
# the workspace volume. This is the equivalent of running `cargo clean` across the
# tree, but selectively: it only removes caches that have either grown pathological
# or gone cold, so actively-used incremental builds survive a rebuild untouched.
#
# Invoked as the final step of scripts/post-deploy-cleanup.sh on every
# `./agentbox.sh rebuild`. Opt out with `rebuild --no-cleanup` or AGENTBOX_REAP_CARGO=0.
# Runs equally well standalone INSIDE the container:  bash scripts/reap-cargo-targets.sh
#
# A `target/` dir (one that has a sibling Cargo.toml — never a coincidental name) is
# reaped when it is EITHER
#   - at least  AGENTBOX_CARGO_REAP_MAX_GB     gigabytes        (default 50), OR
#   - untouched for AGENTBOX_CARGO_REAP_STALE_DAYS days          (default 14).
# Everything reaped is 100% regenerable on the next `cargo build`. No source, no
# git state, no lockfiles are touched.
#
# Tuning:
#   AGENTBOX_CARGO_REAP_ROOT        tree to scan            (default /home/devuser/workspace)
#   AGENTBOX_CARGO_REAP_MAX_GB      runaway size cap, GB    (default 50; 0 = ignore size)
#   AGENTBOX_CARGO_REAP_STALE_DAYS  cold-cache age, days    (default 14; 0 = reap regardless of age)
#   AGENTBOX_CARGO_REAP_DRYRUN      1 = report only         (default 0)
set -uo pipefail

ROOT="${AGENTBOX_CARGO_REAP_ROOT:-/home/devuser/workspace}"
MAX_GB="${AGENTBOX_CARGO_REAP_MAX_GB:-50}"
STALE_DAYS="${AGENTBOX_CARGO_REAP_STALE_DAYS:-14}"
DRYRUN="${AGENTBOX_CARGO_REAP_DRYRUN:-0}"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

# A rebuild must never race an active compile — skip entirely if anything is building.
if pgrep -x cargo >/dev/null 2>&1 || pgrep -x rustc >/dev/null 2>&1; then
    echo -e "${YELLOW}  cargo/rustc is running — skipping target reap (re-run later).${NC}"
    exit 0
fi

if [ ! -d "$ROOT" ]; then
    echo -e "${YELLOW}  reap root not found: ${ROOT} — skipping.${NC}"
    exit 0
fi

max_kb=0
[ "$MAX_GB" -gt 0 ] 2>/dev/null && max_kb=$(( MAX_GB * 1024 * 1024 ))

reaped=0; reaped_kb=0; kept=0

# `-prune` stops the walk descending into a target/ once matched (no nested re-scan).
while IFS= read -r -d '' tgt; do
    proj="$(dirname "$tgt")"
    [ -f "$proj/Cargo.toml" ] || continue   # real cargo target only

    sz_kb=$(du -sxk "$tgt" 2>/dev/null | cut -f1)
    [ -n "${sz_kb:-}" ] || continue

    # Fresh = at least one file modified within STALE_DAYS. STALE_DAYS=0 => never fresh.
    if [ "$STALE_DAYS" -gt 0 ] 2>/dev/null; then
        fresh=$(find "$tgt" -type f -mtime "-${STALE_DAYS}" -print -quit 2>/dev/null)
    else
        fresh=""
    fi

    reason=""
    if [ "$max_kb" -gt 0 ] && [ "$sz_kb" -ge "$max_kb" ]; then
        reason="$(( sz_kb / 1024 / 1024 ))GB >= ${MAX_GB}GB"
    elif [ -z "$fresh" ]; then
        reason="stale >${STALE_DAYS}d"
    fi

    if [ -n "$reason" ]; then
        printf "  reap %-56s (%s)\n" "$tgt" "$reason"
        [ "$DRYRUN" = "1" ] || rm -rf "$tgt"
        reaped=$(( reaped + 1 )); reaped_kb=$(( reaped_kb + sz_kb ))
    else
        kept=$(( kept + 1 ))
    fi
done < <(find "$ROOT" -type d -name target -prune -print0 2>/dev/null)

human=$(awk -v k="$reaped_kb" 'BEGIN{ printf "%.1f", k/1024/1024 }')
if [ "$DRYRUN" = "1" ]; then
    echo -e "${CYAN}  [dry-run] would reap ${reaped} target(s) ~${human}GB; ${kept} kept.${NC}"
else
    echo -e "${GREEN}  reaped ${reaped} target(s), ~${human}GB reclaimed; ${kept} kept.${NC}"
fi
exit 0
