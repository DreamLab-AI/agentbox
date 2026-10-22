#!/usr/bin/env bash
# The isaac-sim GPU picker must only ever touch its own key in the operator's .env.
#   bash tests/isaac-sim/test_gpu_pick.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AB="$HERE/../../agentbox.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0; ok(){ echo "  ok   $1"; }; bad(){ echo "  FAIL $1"; fail=1; }
# Pull just the two helpers out of agentbox.sh so no CLI side effects run.
eval "$(awk '/^isaac_sim_saved_uuid\(\) \{/,/^}/' "$AB"; awk '/^isaac_sim_save_uuid\(\) \{/,/^}/' "$AB")"
SCRIPT_DIR="$TMP"
U=GPU-29e2ace3-b6a5-a33b-6f42-f9d739f94cd6

printf 'A=1\nSECRET=a|b&c\nZ=last\n' > "$TMP/e1"; ISAAC_SIM_ENV_FILE="$TMP/e1" isaac_sim_save_uuid "$U"
[[ "$(head -3 "$TMP/e1")" == $'A=1\nSECRET=a|b&c\nZ=last' && "$(tail -1 "$TMP/e1")" == "ISAAC_SIM_GPU_UUID=$U" ]] \
  && ok "append keeps every existing line byte for byte" || bad "append altered the file"

printf 'A=1\nZ=no-trailing-newline' > "$TMP/e2"; ISAAC_SIM_ENV_FILE="$TMP/e2" isaac_sim_save_uuid "$U"
[[ "$(sed -n 2p "$TMP/e2")" == "Z=no-trailing-newline" && "$(sed -n 3p "$TMP/e2")" == "ISAAC_SIM_GPU_UUID=$U" ]] \
  && ok "missing trailing newline does not glue onto the last line" || bad "glued: $(cat "$TMP/e2")"

printf 'A=1\nISAAC_SIM_GPU_UUID=GPU-old\nB=2\n' > "$TMP/e3"; ISAAC_SIM_ENV_FILE="$TMP/e3" isaac_sim_save_uuid "$U"
[[ "$(tr '\n' ' ' < "$TMP/e3")" == "A=1 ISAAC_SIM_GPU_UUID=$U B=2 " ]] && ok "existing key replaced in place, neighbours untouched" || bad "replace: $(cat "$TMP/e3")"

printf 'A=1\n' > "$TMP/real"; chmod 600 "$TMP/real"; ln -s "$TMP/real" "$TMP/link"
ISAAC_SIM_ENV_FILE="$TMP/link" isaac_sim_save_uuid "$U"
[[ -L "$TMP/link" && "$(stat -c %a "$TMP/real")" == 600 && "$(tail -1 "$TMP/real")" == "ISAAC_SIM_GPU_UUID=$U" ]] \
  && ok "symlink kept, target updated, mode 600 preserved" || bad "symlink/mode handling"

ISAAC_SIM_ENV_FILE="$TMP/new" isaac_sim_save_uuid "$U"; [[ "$(cat "$TMP/new")" == "ISAAC_SIM_GPU_UUID=$U" ]] \
  && ok "absent file is created with just the key" || bad "create"

[[ "$(ISAAC_SIM_ENV_FILE="$TMP/e3" isaac_sim_saved_uuid)" == "$U" ]] && ok "saved value reads back" || bad "read back"
[[ "$(ISAAC_SIM_GPU_UUID=GPU-env ISAAC_SIM_ENV_FILE="$TMP/e3" isaac_sim_saved_uuid)" == "GPU-env" ]] && ok "environment beats .env" || bad "precedence"
ls "$TMP" | grep -q '\.[A-Za-z0-9]\{6\}$' && bad "temp file left behind" || ok "no temp files left behind"

echo "picker under a real pty (fake nvidia-smi, throwaway env file)"
mkdir -p "$TMP/fakebin"; cat > "$TMP/fakebin/nvidia-smi" <<'X'
#!/bin/sh
printf '0, GPU-aaaa, A6000, 36671, 49140, 97\n1, GPU-bbbb, Ada, 27956, 49140, 0\n2, GPU-cccc, Ada, 2718, 49140, 0\n'
X
chmod +x "$TMP/fakebin/nvidia-smi"; export FAKEBIN="$TMP/fakebin"
pick() { python3 -I "$HERE/pty_pick.py" "$1" 2 "$2" "$AB"; }
printf 'KEEP=1\nISAAC_SIM_GPU_UUID=GPU-bbbb\n' > "$TMP/pa"; r="$(pick "$TMP/pa" NONE)"
[[ "$r" == *"RC=0 UUID=GPU-bbbb"* ]] && ok "no input: times out to last time's GPU" || bad "timeout default: $r"
printf 'KEEP=1\nISAAC_SIM_GPU_UUID=GPU-bbbb\n' > "$TMP/pb"; r="$(pick "$TMP/pb" 2,ENTER)"
[[ "$r" == *"UUID=GPU-cccc"* && "$(tail -1 "$TMP/pb")" == "ISAAC_SIM_GPU_UUID=GPU-cccc" && "$(head -1 "$TMP/pb")" == "KEEP=1" ]] \
  && ok "digit jumps, enter confirms, choice saved, other keys untouched" || bad "digit pick: $r"
printf 'ISAAC_SIM_GPU_UUID=GPU-bbbb\n' > "$TMP/pc"; r="$(pick "$TMP/pc" DOWN,ENTER)"
[[ "$r" == *"UUID=GPU-cccc"* ]] && ok "arrow down then enter" || bad "arrow pick: $r"
printf 'KEEP=1\n' > "$TMP/pd"; r="$(pick "$TMP/pd" NONE)"
[[ "$r" == FINISHED*"RC=1"* && "$(cat "$TMP/pd")" == "KEEP=1" ]] && ok "nothing saved and no input: fails closed, picks nothing, hangs nothing" || bad "fail-closed: $r"
exit $fail
