#!/usr/bin/env bash
# ADR-2021 — contract tests for the skills JIT-context lint.
#
# Each case builds a throwaway skills tree in a temp dir, copies the real
# `lint-skills.sh` + `lint-skills.mjs` into it (the lint scopes itself to its
# own directory), runs it, and asserts the exit code and the expected finding
# code. Run: bash tests/config/skill-lint.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LINT_SH="$REPO/skills/lint-skills.sh"
LINT_MJS="${LINT_MJS:-$REPO/skills/lint-skills.mjs}"

pass=0
fail=0

# make_tree <dir> — seed a temp skills root with the real lint.
make_tree() {
  cp "$LINT_SH" "$1/lint-skills.sh"
  cp "$LINT_MJS" "$1/lint-skills.mjs"   # LINT_MJS may point at a staged copy; the wrapper execs ./lint-skills.mjs
}

# check <name> <expected-exit> <expected-substring|-> <tree-dir>
check() {
  local name="$1" want_exit="$2" want_sub="$3" dir="$4"
  local out rc
  out="$(bash "$dir/lint-skills.sh" 2>&1)"
  rc=$?
  local ok=1
  [ "$rc" -eq "$want_exit" ] || ok=0
  if [ "$want_sub" != "-" ]; then
    printf '%s' "$out" | grep -qF -- "$want_sub" || ok=0
  fi
  if [ "$ok" -eq 1 ]; then
    echo "ok   — $name (exit $rc)"
    pass=$((pass + 1))
  else
    echo "FAIL — $name (exit $rc, wanted $want_exit, wanted substring: $want_sub)"
    printf '%s\n' "$out" | sed 's/^/       | /'
    fail=$((fail + 1))
  fi
}

long_body() {
  local n="$1" i
  for ((i = 0; i < n; i++)); do echo "ordinary text"; done
}

# --- 1. valid skill -------------------------------------------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/good"
cat > "$T/good/SKILL.md" <<'EOF'
---
name: good
description: A perfectly ordinary skill with real frontmatter.
version: 0.1.0
triggers:
  - /good
---

# Good

Nothing to see here.
EOF
check "valid skill passes" 0 "OK — skills estate clean" "$T"
rm -rf "$T"

# --- 2. empty frontmatter, fields in the body (ADR-2021 defect a) ---------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\n---\nname: fixture\ndescription: these fields are outside the frontmatter\n' \
  > "$T/fixture/SKILL.md"
check "empty frontmatter with body fields fails" 1 "frontmatter block is empty" "$T"
rm -rf "$T"

# --- 3. over-budget entry, empty references/ (ADR-2021 defect b) ----------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture/references"
{ printf -- '---\nname: fixture\ndescription: fixture\n---\n'; long_body 300; } \
  > "$T/fixture/SKILL.md"
check "over-budget with empty references/ fails" 1 "references/ holds no readable file" "$T"
rm -rf "$T"

# --- 4. over-budget entry, populated references/ -------------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture/references"
{ printf -- '---\nname: fixture\ndescription: fixture\n---\n'; long_body 300; } \
  > "$T/fixture/SKILL.md"
echo "# depth" > "$T/fixture/references/depth.md"
check "over-budget with populated references/ passes" 0 "OK — skills estate clean" "$T"
rm -rf "$T"

# --- 4b. over-budget entry, no references/ at all ------------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
{ printf -- '---\nname: fixture\ndescription: fixture\n---\n'; long_body 300; } \
  > "$T/fixture/SKILL.md"
check "over-budget with no references/ fails" 1 "no references/" "$T"
rm -rf "$T"

# --- 5. missing referenced resource (ADR-2021 defect c) ------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture/references"
echo "# real" > "$T/fixture/references/real.md"
cat > "$T/fixture/SKILL.md" <<'EOF'
---
name: fixture
description: cites one resource that exists and one that does not.
---

- [real](references/real.md)
- [ghost](references/ghost.md)
EOF
check "missing referenced resource fails" 1 "referenced resource does not exist: references/ghost.md" "$T"
rm -rf "$T"

# --- 5b. missing script/asset paths in the three cited forms -------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
cat > "$T/fixture/SKILL.md" <<'EOF'
---
name: fixture
description: cites a missing script by backtick and a missing asset bare.
---

Run `scripts/does-not-exist.sh` first.

assets/missing.png
EOF
check "missing backtick + bare paths fail" 1 "scripts/does-not-exist.sh" "$T"
check "missing bare asset path fails" 1 "assets/missing.png" "$T"
rm -rf "$T"

# --- 6. no frontmatter at all --------------------------------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf '# Just a heading\n\nname: fixture\ndescription: nope\n' > "$T/fixture/SKILL.md"
check "no frontmatter fails" 1 "missing opening --- on line 1" "$T"
rm -rf "$T"

# --- 6b. frontmatter never closed ----------------------------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\nname: fixture\ndescription: unterminated\n\n# Body\n' > "$T/fixture/SKILL.md"
check "unclosed frontmatter fails" 1 "never closed by a --- line" "$T"
rm -rf "$T"

# --- 7. name present, description empty ----------------------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\nname: fixture\ndescription:\n---\n\n# Body\n' > "$T/fixture/SKILL.md"
check "empty description fails" 1 "\`description\` must be a non-empty scalar" "$T"
rm -rf "$T"

# --- 7b. description present only as a nested mapping --------------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\nname: fixture\ndescription:\n  text: nested\n---\n\n# Body\n' > "$T/fixture/SKILL.md"
check "nested (non-scalar) description fails" 1 "must be a non-empty scalar (got nested)" "$T"
rm -rf "$T"

# --- 8. quoted + block-scalar frontmatter values are accepted ------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
cat > "$T/fixture/SKILL.md" <<'EOF'
---
name: "fixture"   # trailing comment
description: >
  A folded block scalar spanning
  two physical lines.
depends_on_mcps:
  - code-interpreter
---

# Body
EOF
check "quoted name + folded description pass" 0 "OK — skills estate clean" "$T"
rm -rf "$T"

# --- 8b. a description that is only a comment is not a value ------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\nname: fixture\ndescription: # only a comment\n---\n\n# Body\n' > "$T/fixture/SKILL.md"
check "comment-only description fails" 1 "\`description\` must be a non-empty scalar" "$T"
rm -rf "$T"

# --- 9. frontmatter block present but carrying no mapping ---------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\n- just\n- a\n- sequence\n---\n\n# Body\n' > "$T/fixture/SKILL.md"
check "sequence-only frontmatter fails" 1 "sequence, not a mapping" "$T"
rm -rf "$T"

# --- 10. suppression: counted separately, never semantic validation -----
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
cat > "$T/fixture/SKILL.md" <<'EOF'
---
name: fixture
description: deliberately cites a resource that is not shipped yet.
---

- [planned](references/day-two.md) <!-- lint-ok: planned, not shipped -->
EOF
check "lint-ok suppresses a missing resource" 0 "SUPPRESSED RESOURCE" "$T"
check "suppression is reported in the summary" 0 "1 suppressed" "$T"
rm -rf "$T"

# --- 11. suppression cannot wave through a frontmatter defect ----------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
printf -- '---\n---\nname: fixture <!-- lint-ok -->\ndescription: body field\n' > "$T/fixture/SKILL.md"
check "lint-ok cannot fake frontmatter validity" 1 "FRONTMATTER" "$T"
rm -rf "$T"

# --- 12. banned stale string still fails (regression on the old checks) --
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/fixture"
cat > "$T/fixture/SKILL.md" <<'EOF'
---
name: fixture
description: points at a host that no longer exists.
---

Call the model at http://192.168.2.48:8084/v1 for inference.
EOF
check "banned stale host still fails" 1 "STALE" "$T"
rm -rf "$T"

# --- 13. NAME: frontmatter name must equal the directory (audit 2026-09-09) ---
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/my-skill"
printf -- '---\nname: "My Skill"\ndescription: Title-case display names were taught by the old skill-builder.\n---\n# x\n' > "$T/my-skill/SKILL.md"
check "Title-Case name fails NAME" 1 "NAME" "$T"
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/my-skill"
printf -- '---\nname: other-skill\ndescription: A lowercase name that does not match its directory still fails.\n---\n# x\n' > "$T/my-skill/SKILL.md"
check "name != directory fails NAME" 1 "must equal the directory name" "$T"

# --- 14. DESCLEN: description over the agentskills.io cap fails ------------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/longdesc"
{ printf -- '---\nname: longdesc\ndescription: "'; head -c 1100 /dev/zero | tr '\0' 'x'; printf '"\n---\n# x\n'; } > "$T/longdesc/SKILL.md"
check "description > 1024 chars fails DESCLEN" 1 "DESCLEN" "$T"

# --- 15. DEPRECATED: a redirect stub must carry deprecated + replacement ---
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/old-skill" "$T/new-skill"
printf -- '---\nname: new-skill\ndescription: The replacement skill that the stub should point at explicitly.\n---\n# x\n' > "$T/new-skill/SKILL.md"
printf -- '---\nname: old-skill\ndescription: "DEPRECATED — merged into new-skill. Use new-skill for everything this did."\n---\n# x\n' > "$T/old-skill/SKILL.md"
check "redirect stub without keys fails DEPRECATED" 1 "DEPRECATED" "$T"
printf -- '---\nname: old-skill\ndescription: "DEPRECATED — merged into new-skill. Use new-skill for everything this did."\ndeprecated: true\nreplacement: new-skill\n---\n# x\n' > "$T/old-skill/SKILL.md"
check "redirect stub with keys passes" 0 "OK — skills estate clean" "$T"

# --- 16. REGISTERED: manifest entries must resolve and not be stubs ------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/real"
printf -- '---\nname: real\ndescription: A registered skill that exists and is not a redirect stub at all.\n---\n# x\n' > "$T/real/SKILL.md"
printf 'real\nghost\n' > "$T/registered-skills.txt"
check "manifest entry without a skill dir fails REGISTERED" 1 "REGISTERED" "$T"
printf 'real\n' > "$T/registered-skills.txt"
check "manifest entry that resolves passes" 0 "OK — skills estate clean" "$T"

# --- 17. ABSPATH: the expanded /home/devuser form is banned too ----------
T=$(mktemp -d); make_tree "$T"; mkdir -p "$T/abs"
printf -- '---\nname: abs\ndescription: Documents an install step with an expanded absolute skills path.\n---\ncp x /home/devuser/.claude/skills/abs/\n' > "$T/abs/SKILL.md"
check "expanded ~/.claude/skills path fails ABSPATH" 1 "ABSPATH" "$T"

echo
echo "skill-lint: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
