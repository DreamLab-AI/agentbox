#!/usr/bin/env bash
# ADR-2092 — contract tests for the agent and command reconcilers.
#
# Each case builds throwaway agent/command roots in a temp dir, runs the real
# reconciler against them, and asserts the resulting tree. The properties under
# test are the ones that make it safe to run unattended on every boot:
#   - the registered set is linked from the baked tree,
#   - vendor dumps are retired to a RECOVERABLE sidecar, never deleted, and that
#     sidecar sits OUTSIDE every agent/command root (Claude Code scans the roots
#     recursively, dot-directories included, so an in-root `.superseded/` kept
#     every retired file loaded),
#   - a legacy in-root `.superseded/` is migrated out, merging without clobbering,
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
  AGENTBOX_SUPERSEDED_DIR="$SUP" \
    bash "$AGENT_SH" ${3:-} 2>&1
}

run_cmds() {
  COMMAND_ROOT_TARGETS="$1" \
  REGISTERED_COMMANDS_MANIFEST="$CMD_MANIFEST" \
  AGENTBOX_SUPERSEDED_DIR="$SUP" \
    bash "$CMD_SH" ${2:-} 2>&1
}

# the reconcilers' root-key slug: path minus the trailing /<kind>, slashes -> '-'
root_key() { local r="${1%/}"; r="${r%/"$2"}"; r="${r#/}"; printf '%s' "${r//\//-}"; }

# assert_no_legacy <label> <dir>... — no in-root .superseded/ may remain anywhere
assert_no_legacy() {
  local label="$1"; shift
  local hits; hits="$(find "$@" -name .superseded 2>/dev/null)"
  [ -z "$hits" ] && ok "$label" || bad "$label" "$hits"
}

# assert_outside <label> <path> <root>... — path is not inside any root
assert_outside() {
  local label="$1" p="$2" r; shift 2
  for r in "$@"; do
    case "$p/" in "${r%/}/"*) bad "$label" "$p is inside $r"; return ;; esac
  done
  ok "$label"
}

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
SUP="$T/sidecar"

# ── fixture ────────────────────────────────────────────────────────────────
PRIMARY="$T/home/.claude/agents"; SECOND="$T/ws/.claude/agents"
mkdir -p "$PRIMARY/core" "$PRIMARY/v3" "$SECOND/core"
# a vendor agent in a category dir, carrying a vendor marker
printf -- '---\nname: coder\ndescription: d\n---\nhooks:\n  echo "🐝 swarm"\nnpx claude-flow hooks pre-task\n' > "$PRIMARY/core/coder.md"
# a vendor copy whose basename MATCHES a registered agent — must not survive
printf -- '---\nname: adr-architect\ndescription: legacy v3 copy\n---\nmcp__claude-flow__swarm_init\n' > "$PRIMARY/v3/adr-architect.md"
# a hand-written flat agent with no vendor marker — must be preserved
printf -- '---\nname: my-own\ndescription: mine\n---\nbody\n' > "$PRIMARY/my-own.md"
# the secondary root is collapsed wholesale
printf -- '---\nname: tester\ndescription: d\n---\nbody\n' > "$SECOND/core/tester.md"

SP="$SUP/agents/$(root_key "$PRIMARY" agents)"
SS="$SUP/agents/$(root_key "$SECOND" agents)"

out="$(run_agents "$PRIMARY" "$SECOND")"

echo "agents:"
case "$SP" in *-home-.claude) ok "root key is a readable slug minus /agents" ;;
  *) bad "root key is a readable slug minus /agents" "$SP" ;; esac
assert_file  "registered agent is linked"            "$PRIMARY/code-reviewer.md"
[ -L "$PRIMARY/code-reviewer.md" ] && ok "linked as a symlink into the baked tree" \
  || bad "linked as a symlink into the baked tree" "not a symlink"
refute_file  "vendor agent retired from category dir" "$PRIMARY/core/coder.md"
assert_file  "…and is recoverable from the sidecar"   "$SP/core/coder.md"
refute_file  "shadowing vendor copy retired"          "$PRIMARY/v3/adr-architect.md"
assert_file  "…and is recoverable from the sidecar"   "$SP/v3/adr-architect.md"
assert_file  "registered agent still linked after that" "$PRIMARY/adr-architect.md"
assert_file  "hand-written agent preserved"           "$PRIMARY/my-own.md"
[ ! -L "$PRIMARY/my-own.md" ] && ok "hand-written agent untouched (still a real file)" \
  || bad "hand-written agent untouched" "was replaced by a link"
refute_file  "secondary root collapsed"               "$SECOND/core/tester.md"
assert_file  "…and is recoverable from the sidecar"   "$SS/core/tester.md"
refute_file  "emptied category dir removed"           "$PRIMARY/core"
assert_outside "sidecar sits outside every agent root" "$SUP" "$PRIMARY" "$SECOND"
assert_no_legacy "no .superseded/ inside any agent root" "$PRIMARY" "$SECOND"

# no .md may remain in a subdirectory of the live root — that is the shadowing
# class, and with the sidecar outside the root there is nothing to exempt
leftover="$(find "$PRIMARY" "$SECOND" -mindepth 2 -name '*.md' 2>/dev/null)"
[ -z "$leftover" ] && ok "no nested agent left under any root" \
  || bad "no nested agent left under any root" "$leftover"

# ── idempotency ────────────────────────────────────────────────────────────
before="$(find "$PRIMARY" "$SECOND" "$SUP" | sort | md5sum)"
run_agents "$PRIMARY" "$SECOND" >/dev/null
after="$(find "$PRIMARY" "$SECOND" "$SUP" | sort | md5sum)"
[ "$before" = "$after" ] && ok "second run is a no-op" || bad "second run is a no-op" "tree changed"

# ── legacy in-root sidecar is migrated out (the self-healing path) ─────────
L="$T/legacy/.claude/agents"; LS="$SUP/agents/$(root_key "$L" agents)"
mkdir -p "$L/.superseded/core" "$L/.superseded/v3" "$LS/v3"
printf 'old\n'  > "$L/.superseded/core/old.md"
printf 'same\n' > "$L/.superseded/v3/dup.md";  printf 'same\n'  > "$LS/v3/dup.md"
printf 'mine\n' > "$L/.superseded/v3/diff.md"; printf 'theirs\n' > "$LS/v3/diff.md"
printf 'x: 1\n' > "$L/.superseded/v3/notes.yaml"
run_agents "$L" "" >/dev/null
assert_no_legacy "legacy agent sidecar removed from the root" "$L"
assert_file  "legacy file migrated to the new sidecar"   "$LS/core/old.md"
assert_file  "non-.md legacy file migrated too"          "$LS/v3/notes.yaml"
[ "$(cat "$LS/v3/dup.md")" = "same" ] && [ ! -e "$LS/v3/dup.md.migrated-1" ] \
  && ok "identical legacy duplicate merged, not doubled" \
  || bad "identical legacy duplicate merged, not doubled" "$(ls "$LS/v3")"
[ "$(cat "$LS/v3/diff.md")" = "theirs" ] && [ "$(cat "$LS/v3/diff.md.migrated-1" 2>/dev/null)" = "mine" ] \
  && ok "differing legacy file kept beside, never overwrites" \
  || bad "differing legacy file kept beside, never overwrites" "$(ls "$LS/v3")"
lb="$(find "$L" "$SUP" | sort | md5sum)"
run_agents "$L" "" >/dev/null
la="$(find "$L" "$SUP" | sort | md5sum)"
[ "$lb" = "$la" ] && ok "migration is idempotent" || bad "migration is idempotent" "tree changed"

# a legacy sidecar in a SECONDARY root is migrated as well
L2="$T/legacy2/.claude/agents"; mkdir -p "$L2/.superseded/core"
printf 'old\n' > "$L2/.superseded/core/old2.md"
run_agents "$T/p2/.claude/agents" "$L2" >/dev/null
assert_no_legacy "legacy sidecar in a secondary root migrated" "$L2"
assert_file "…into that root's own sidecar key" "$SUP/agents/$(root_key "$L2" agents)/core/old2.md"

# ── default base: beside the root's parent .claude, never under $HOME ───────
DF="$T/dflt/.claude/agents"; mkdir -p "$DF/core"
printf -- '---\nname: coder\n---\nruv-swarm\n' > "$DF/core/coder.md"
AGENTS_TREE="$AGENTS_TREE_SRC" CLAUDE_AGENTS_DIR="$DF" AGENT_ROOT_TARGETS="" \
  REGISTERED_AGENTS_MANIFEST="$AGENT_MANIFEST" HOME="$T/nohome" \
  bash "$AGENT_SH" >/dev/null 2>&1
assert_file "default sidecar is <.claude>/agentbox-superseded" \
  "$T/dflt/.claude/agentbox-superseded/agents/$(root_key "$DF" agents)/core/coder.md"
refute_file "…and does not depend on \$HOME" "$T/nohome"

# ── dry-run ────────────────────────────────────────────────────────────────
D="$T/dry/.claude/agents"; mkdir -p "$D/core" "$D/.superseded/core"
printf -- '---\nname: coder\ndescription: d\n---\nruv-swarm\n' > "$D/core/coder.md"
printf 'old\n' > "$D/.superseded/core/old.md"
b="$(find "$T/dry" "$SUP" | sort | md5sum)"
run_agents "$D" "" --dry-run >/dev/null
a="$(find "$T/dry" "$SUP" | sort | md5sum)"
[ "$b" = "$a" ] && ok "--dry-run changes nothing (retire or migrate)" || bad "--dry-run changes nothing" "tree changed"

# ── missing manifest is a no-op, not a failure (fail-open) ─────────────────
AGENTS_TREE="$AGENTS_TREE_SRC" CLAUDE_AGENTS_DIR="$D" REGISTERED_AGENTS_MANIFEST="$T/nope.txt" \
  bash "$AGENT_SH" >/dev/null 2>&1
[ $? -eq 0 ] && ok "missing manifest exits 0 (fail-open)" || bad "missing manifest exits 0" "non-zero exit"

# ── commands ───────────────────────────────────────────────────────────────
echo "commands:"
C="$T/home/.claude/commands"; C2="$T/ws/.claude/commands"
mkdir -p "$C/sparc" "$C2/github" "$C2/.superseded/hooks"
printf -- 'kept\n'   > "$C/dream.md"
printf -- 'vendor\n' > "$C/sparc/tdd.md"
printf -- 'vendor\n' > "$C2/github/pr.md"
printf -- 'legacy\n' > "$C2/.superseded/hooks/pre-edit.md"
CS="$SUP/commands/$(root_key "$C" commands)"; CS2="$SUP/commands/$(root_key "$C2" commands)"
run_cmds "$C:$C2" >/dev/null
assert_file "registered command kept"          "$C/dream.md"
refute_file "vendor command retired"           "$C/sparc/tdd.md"
assert_file "…and is recoverable from the sidecar" "$CS/sparc/tdd.md"
refute_file "second-root command retired"      "$C2/github/pr.md"
assert_file "…into that root's own sidecar key" "$CS2/github/pr.md"
refute_file "emptied command dir removed"      "$C/sparc"
assert_file "legacy command sidecar migrated"  "$CS2/hooks/pre-edit.md"
assert_outside "command sidecar sits outside every command root" "$SUP" "$C" "$C2"
assert_no_legacy "no .superseded/ inside any command root" "$C" "$C2"
left="$(find "$C" "$C2" -type f ! -path "$C/dream.md" 2>/dev/null)"
[ -z "$left" ] && ok "nothing but the registered command left to load" \
  || bad "nothing but the registered command left to load" "$left"

cb="$(find "$C" "$C2" "$SUP" | sort | md5sum)"
run_cmds "$C:$C2" >/dev/null
ca="$(find "$C" "$C2" "$SUP" | sort | md5sum)"
[ "$cb" = "$ca" ] && ok "second run is a no-op" || bad "second run is a no-op" "tree changed"

CD="$T/cdry/.claude/commands"; mkdir -p "$CD/sparc" "$CD/.superseded/x"
printf 'v\n' > "$CD/sparc/a.md"; printf 'v\n' > "$CD/.superseded/x/b.md"
cb="$(find "$T/cdry" "$SUP" | sort | md5sum)"
run_cmds "$CD" --dry-run >/dev/null
ca="$(find "$T/cdry" "$SUP" | sort | md5sum)"
[ "$cb" = "$ca" ] && ok "commands --dry-run changes nothing" || bad "commands --dry-run changes nothing" "tree changed"

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
