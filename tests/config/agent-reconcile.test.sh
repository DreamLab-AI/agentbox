#!/usr/bin/env bash
# ADR-2092 — contract tests for the agent and command reconcilers.
#
# Each case builds throwaway agent/command roots in a temp dir, runs the real
# reconciler against them, and asserts the resulting tree. The properties under
# test are the ones that make it safe to run unattended on every boot:
#   - the registered set is linked from the baked tree,
#   - vendor dumps are retired to a RECOVERABLE sidecar, never deleted,
#   - a vendor copy sharing a registered basename cannot survive to shadow it,
#   - hand-written agents are left alone,
#   - secondary roots are collapsed,
#   - the run is idempotent and --dry-run changes nothing.
# Run: bash tests/config/agent-reconcile.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
AGENT_SH="$REPO/scripts/reconcile-agents.sh"
CMD_SH="$REPO/scripts/reconcile-commands.sh"
AGENTS_TREE_SRC="$REPO/agents"
AGENT_MANIFEST="$AGENTS_TREE_SRC/registered-agents.txt"
CMD_MANIFEST="$REPO/config/registered-commands.txt"

pass=0
fail=0

ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

# assert_file <label> <path>
assert_file() { [ -e "$2" ] && ok "$1" || bad "$1" "missing: $2"; }
# refute_file <label> <path>
refute_file() { [ ! -e "$2" ] && ok "$1" || bad "$1" "should not exist: $2"; }

run_agents() {
  AGENTS_TREE="$AGENTS_TREE_SRC" \
  CLAUDE_AGENTS_DIR="$1" \
  AGENT_ROOT_TARGETS="${2:-}" \
  REGISTERED_AGENTS_MANIFEST="$AGENT_MANIFEST" \
    bash "$AGENT_SH" ${3:-} 2>&1
}

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# ── fixture ────────────────────────────────────────────────────────────────
PRIMARY="$T/primary"; SECOND="$T/second"
mkdir -p "$PRIMARY/core" "$PRIMARY/v3" "$SECOND/core"
# a vendor agent in a category dir, carrying a vendor marker
printf -- '---\nname: coder\ndescription: d\n---\nhooks:\n  echo "🐝 swarm"\nnpx claude-flow hooks pre-task\n' > "$PRIMARY/core/coder.md"
# a vendor copy whose basename MATCHES a registered agent — must not survive
printf -- '---\nname: adr-architect\ndescription: legacy v3 copy\n---\nmcp__claude-flow__swarm_init\n' > "$PRIMARY/v3/adr-architect.md"
# a hand-written flat agent with no vendor marker — must be preserved
printf -- '---\nname: my-own\ndescription: mine\n---\nbody\n' > "$PRIMARY/my-own.md"
# the secondary root is collapsed wholesale
printf -- '---\nname: tester\ndescription: d\n---\nbody\n' > "$SECOND/core/tester.md"

out="$(run_agents "$PRIMARY" "$SECOND")"

echo "agents:"
assert_file  "registered agent is linked"            "$PRIMARY/code-reviewer.md"
[ -L "$PRIMARY/code-reviewer.md" ] && ok "linked as a symlink into the baked tree" \
  || bad "linked as a symlink into the baked tree" "not a symlink"
refute_file  "vendor agent retired from category dir" "$PRIMARY/core/coder.md"
assert_file  "…and is recoverable"                    "$PRIMARY/.superseded/core/coder.md"
refute_file  "shadowing vendor copy retired"          "$PRIMARY/v3/adr-architect.md"
assert_file  "…and is recoverable"                    "$PRIMARY/.superseded/v3/adr-architect.md"
assert_file  "registered agent still linked after that" "$PRIMARY/adr-architect.md"
assert_file  "hand-written agent preserved"           "$PRIMARY/my-own.md"
[ ! -L "$PRIMARY/my-own.md" ] && ok "hand-written agent untouched (still a real file)" \
  || bad "hand-written agent untouched" "was replaced by a link"
refute_file  "secondary root collapsed"               "$SECOND/core/tester.md"
assert_file  "…and is recoverable"                    "$SECOND/.superseded/core/tester.md"
refute_file  "emptied category dir removed"           "$PRIMARY/core"
assert_file  "sidecar survives dir pruning"           "$PRIMARY/.superseded"

# no .md may remain in a subdirectory of the live root — that is the shadowing class
leftover="$(find "$PRIMARY" -mindepth 2 -name '*.md' -not -path "$PRIMARY/.superseded/*" 2>/dev/null)"
[ -z "$leftover" ] && ok "no nested agent left to shadow a registered name" \
  || bad "no nested agent left to shadow a registered name" "$leftover"

# ── idempotency ────────────────────────────────────────────────────────────
before="$(find "$PRIMARY" "$SECOND" | sort | md5sum)"
run_agents "$PRIMARY" "$SECOND" >/dev/null
after="$(find "$PRIMARY" "$SECOND" | sort | md5sum)"
[ "$before" = "$after" ] && ok "second run is a no-op" || bad "second run is a no-op" "tree changed"

# ── dry-run ────────────────────────────────────────────────────────────────
D="$T/dry"; mkdir -p "$D/core"
printf -- '---\nname: coder\ndescription: d\n---\nruv-swarm\n' > "$D/core/coder.md"
b="$(find "$D" | sort | md5sum)"
run_agents "$D" "" --dry-run >/dev/null
a="$(find "$D" | sort | md5sum)"
[ "$b" = "$a" ] && ok "--dry-run changes nothing" || bad "--dry-run changes nothing" "tree changed"

# ── missing manifest is a no-op, not a failure (fail-open) ─────────────────
AGENTS_TREE="$AGENTS_TREE_SRC" CLAUDE_AGENTS_DIR="$D" REGISTERED_AGENTS_MANIFEST="$T/nope.txt" \
  bash "$AGENT_SH" >/dev/null 2>&1
[ $? -eq 0 ] && ok "missing manifest exits 0 (fail-open)" || bad "missing manifest exits 0" "non-zero exit"

# ── commands ───────────────────────────────────────────────────────────────
echo "commands:"
C="$T/cmds"; mkdir -p "$C/sparc"
printf -- 'kept\n'  > "$C/dream.md"
printf -- 'vendor\n' > "$C/sparc/tdd.md"
COMMAND_ROOT_TARGETS="$C" REGISTERED_COMMANDS_MANIFEST="$CMD_MANIFEST" bash "$CMD_SH" >/dev/null 2>&1
assert_file "registered command kept"      "$C/dream.md"
refute_file "vendor command retired"       "$C/sparc/tdd.md"
assert_file "…and is recoverable"          "$C/.superseded/sparc/tdd.md"
refute_file "emptied command dir removed"  "$C/sparc"

cb="$(find "$C" | sort | md5sum)"
COMMAND_ROOT_TARGETS="$C" REGISTERED_COMMANDS_MANIFEST="$CMD_MANIFEST" bash "$CMD_SH" >/dev/null 2>&1
ca="$(find "$C" | sort | md5sum)"
[ "$cb" = "$ca" ] && ok "second run is a no-op" || bad "second run is a no-op" "tree changed"

# ── ancestor skill roots honour registered-skills.txt (the manifest leak) ──
echo "skill roots:"
PROJ="$REPO/scripts/project-skill-roots.mjs"
SK="$T/skroot"; mkdir -p "$SK"
# an unregistered baked skill must NOT survive in an ancestor root
mkdir -p "$SK/sparc-methodology"; printf -- '---\nname: sparc-methodology\n---\n' > "$SK/sparc-methodology/SKILL.md"
# an allowlisted one must survive
mkdir -p "$SK/keep-me"; printf -- '---\nname: keep-me\n---\n' > "$SK/keep-me/SKILL.md"
printf 'keep-me\n' > "$T/overlay.txt"
SKILLS_TREE="$REPO/skills" SKILL_ROOT_TARGETS="$SK"   REGISTERED_SKILLS_MANIFEST="$REPO/skills/registered-skills.txt"   OVERLAY_SKILLS_MANIFEST="$T/overlay.txt"   node "$PROJ" >/dev/null 2>&1
refute_file "unregistered skill retired from ancestor root" "$SK/sparc-methodology"
assert_file "allowlisted overlay skill preserved"           "$SK/keep-me"

# fail-open: an unreadable manifest must prune NOTHING, not everything
SK2="$T/skroot2"; mkdir -p "$SK2/sparc-methodology"
printf -- '---\nname: sparc-methodology\n---\n' > "$SK2/sparc-methodology/SKILL.md"
SKILLS_TREE="$REPO/skills" SKILL_ROOT_TARGETS="$SK2"   REGISTERED_SKILLS_MANIFEST="$T/absent.txt" OVERLAY_SKILLS_MANIFEST="$T/absent.txt"   node "$PROJ" >/dev/null 2>&1
assert_file "unreadable manifest prunes nothing (fail-open)" "$SK2/sparc-methodology"

# ── manifest integrity ─────────────────────────────────────────────────────
echo "manifest:"
miss=""
while IFS= read -r raw; do
  n="${raw%%#*}"; n="$(printf '%s' "$n" | tr -d '[:space:]')"
  [ -z "$n" ] && continue
  [ -f "$AGENTS_TREE_SRC/$n.md" ] || miss="$miss $n"
done < "$AGENT_MANIFEST"
[ -z "$miss" ] && ok "every registered agent is baked" || bad "every registered agent is baked" "missing:$miss"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
