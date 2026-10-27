#!/usr/bin/env bash
# ADR-2151: voicelink's hook registration. Extracts the two node heredocs the
# entrypoint runs (VLJS: Claude Stop/Notification; VLCODEXJS: Codex notify) and
# drives them against scratch files, so the reconcile semantics are tested on
# the shipped text: register, idempotent, self-heal a stale entry, preserve
# foreign hooks and a foreign notify, de-register when the gate is off. Also
# checks the Nix gating is lazy and no /nix/store path is recorded.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
entry="$root/config/entrypoint-unified.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

heredoc() { awk -v tag="<<'$1'" 'index($0,tag){f=1;next} f&&$0==ENVIRON_TAG{exit} f{print}' ENVIRON_TAG="$1" "$entry"; }
heredoc VLJS > "$tmp/vl.js"
heredoc VLCODEXJS > "$tmp/vlcodex.js"
[[ -s "$tmp/vl.js" && -s "$tmp/vlcodex.js" ]] || { echo "FAIL: heredocs not found in $entry"; exit 1; }
node --check "$tmp/vl.js"; node --check "$tmp/vlcodex.js"

pass=0; fail=0
check() { if [[ "$2" == "$3" ]]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1: got [$2] want [$3]"; fi; }
CMD='/opt/agentbox/bin/voice-paned record --source claude || true'
same_file() { [[ "$(<"$1")" == "$(<"$2")" ]]; }
q() { node -e "const s=JSON.parse(require('fs').readFileSync('$1','utf8'));$2"; }
runc() { VL_ON="$1" SETTINGS="$tmp/settings.json" node "$tmp/vl.js" >/dev/null; }
runx() { VL_ON="$1" CODEX_CFG="$tmp/config.toml" node "$tmp/vlcodex.js"; }

# ── Claude settings ──
echo '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node /x/other.cjs || true","timeout":10}]}]}}' > "$tmp/settings.json"
runc 1
check "Stop registered once, foreign hook kept" "$(q "$tmp/settings.json" "console.log(s.hooks.Stop.length+':'+s.hooks.Stop.filter(g=>g.hooks[0].command==='$CMD').length)")" "2:1"
check "Notification registered" "$(q "$tmp/settings.json" "console.log(s.hooks.Notification[0].hooks[0].command==='$CMD')")" "true"
check "timeout is 5 seconds" "$(q "$tmp/settings.json" "console.log(s.hooks.Notification[0].hooks[0].timeout)")" "5"
cp "$tmp/settings.json" "$tmp/before.json"; runc 1
check "second run is byte-identical" "$(same_file "$tmp/before.json" "$tmp/settings.json" && echo same || echo differ)" "same"
# stale: old store path, wrong timeout, plus a duplicate
echo '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/nix/store/abc-voice-paned/bin/voice-paned record --source claude","timeout":8000}]},{"hooks":[{"type":"command","command":"voice-paned record","timeout":5}]}]}}' > "$tmp/settings.json"
runc 1
check "stale and duplicate entries collapse to one canonical" "$(q "$tmp/settings.json" "console.log(JSON.stringify(s.hooks.Stop.map(g=>[g.hooks[0].command,g.hooks[0].timeout])))")" "[[\"$CMD\",5]]"
check "no /nix/store path recorded" "$(grep -c '/nix/store' "$tmp/settings.json" || true)" "0"
runc 0
check "gate off removes every voice-paned entry and empty events" "$(q "$tmp/settings.json" "console.log(JSON.stringify(s.hooks))")" "{}"
echo '{"theme":"dark"}' > "$tmp/settings.json"; cp "$tmp/settings.json" "$tmp/before.json"; runc 0
check "gate off leaves a hook-less file untouched" "$(same_file "$tmp/before.json" "$tmp/settings.json" && echo same || echo differ)" "same"

# ── Codex notify ──
NOTIFY='notify = ["/opt/agentbox/bin/voice-paned", "record", "--source", "codex"]'
printf 'sandbox_mode = "danger-full-access"\n\n[projects."/w"]\ntrust_level = "trusted"\n' > "$tmp/config.toml"
runx 1 >/dev/null
check "notify written above the first table" "$(grep -n -m1 '^notify\|^\[' "$tmp/config.toml" | head -1 | cut -d: -f2-)" "$NOTIFY"
cp "$tmp/config.toml" "$tmp/before.toml"; runx 1 >/dev/null
check "codex run is idempotent" "$(same_file "$tmp/before.toml" "$tmp/config.toml" && echo same || echo differ)" "same"
sed -i 's|^notify = .*|notify = ["/nix/store/old/bin/voice-paned"]|' "$tmp/config.toml"; runx 1 >/dev/null
check "stale notify self-heals" "$(grep -c -F "$NOTIFY" "$tmp/config.toml")" "1"
runx 0 >/dev/null
check "gate off removes our notify and marker" "$(grep -c 'voice' "$tmp/config.toml" || true)" "0"
check "gate off keeps the rest of the file" "$(grep -c 'trust_level' "$tmp/config.toml")" "1"
# marker stripped by a foreign re-serialiser: still recognised by value, still healed and removable
printf 'notify = ["/nix/store/old/bin/voice-paned"]\n\n[projects."/w"]\n' > "$tmp/config.toml"; runx 1 >/dev/null
check "marker-less stale notify is healed by value" "$(grep -c -F "$NOTIFY" "$tmp/config.toml")" "1"
printf 'notify = ["/opt/agentbox/bin/voice-paned", "record", "--source", "codex"]\n\n[projects."/w"]\n' > "$tmp/config.toml"; runx 0 >/dev/null
check "marker-less notify is removed when the gate is off" "$(grep -c 'voice' "$tmp/config.toml" || true)" "0"
printf 'notify = ["my-notifier"]\n\n[projects."/w"]\n' > "$tmp/config.toml"; cp "$tmp/config.toml" "$tmp/before.toml"
msg="$(runx 1)"
check "a foreign notify is never replaced" "$(same_file "$tmp/before.toml" "$tmp/config.toml" && echo same || echo differ)" "same"
check "a foreign notify is reported" "$([[ "$msg" == *"own notify"* ]] && echo yes || echo no)" "yes"
runx 0 >/dev/null
check "gate off never removes a foreign notify" "$(grep -c 'my-notifier' "$tmp/config.toml")" "1"

# ── Nix gating ──
nix="$root/lib/voice-paned.nix"
check "derivation builds only voice-paned" "$(grep -c '"-p" "voice-paned"' "$nix")" "2"
check "derivation puts tmux, bash and script on the check path" "$(grep -c 'nativeCheckInputs = \[ pkgs.tmux pkgs.bash pkgs.util-linux \]' "$nix")" "1"
rev=$(sed -n 's/^  rev = "\([0-9a-f]\{40\}\)";$/\1/p' "$nix")
check "rev is pinned to a real commit" "$([[ -n $rev && $rev != 0000000000000000000000000000000000000000 ]] && echo 1 || echo 0)" "1"
check "no fakeHash left in the derivation" "$(grep -c 'fakeHash' "$nix")" "0"
check "pinned lockfile exists" "$([[ -f $root/lib/lockfiles/agentbox-voicelink-${rev:0:8}.Cargo.lock ]] && echo 1 || echo 0)" "1"
check "package list is gated on [voicelink].enabled" "$(grep -c 'voicelinkPackages = lib.optionals voicelinkOn' "$root/flake.nix")" "1"
check "bin symlink is gated on [voicelink].enabled" "$(grep -c 'lib.optionalString voicelinkOn' "$root/flake.nix")" "1"
check "voicePanedPkg is referenced only through the gates" "$(grep -c 'voicePanedPkg' "$root/flake.nix")" "3"

echo "voicelink-projection: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
