#!/usr/bin/env bash
# Skills estate freshness + progressive-discovery lint (2026-08-21 audit follow-up).
# Run from skills/: ./lint-skills.sh   Exit non-zero if any finding.
set -u
cd "$(dirname "$0")"
fail=0

# 1. Banned stale strings (stale SDKs, retired runtime paths, dead hosts, wrong embeddings).
BANNED='MiniLM|google\.generativeai|gemini-2\.0-flash-exp|openai-user|gemini-user|192\.168\.2\.48|agent-browser|@claude-flow/browser'
SUPPRESS='DEAD|dead|retired|legacy|is not|never target|lint-ok'
while IFS= read -r hit; do
  echo "STALE  $hit"; fail=1
done < <(grep -rInE "$BANNED" --include='SKILL.md' . | grep -vE "$SUPPRESS" | grep -v 'lint-skills')

# 2. Absolute ~/.claude/skills paths (skills are baked at /opt/agentbox/skills — use skill-relative paths).
while IFS= read -r hit; do
  echo "ABSPATH $hit"; fail=1
done < <(grep -rIn '~/.claude/skills/' --include='SKILL.md' --exclude-dir=skill-builder --exclude-dir=architecture-studio . | grep -vE '/opt/agentbox/skills|lint-ok')

# 3. Retired literal /workspace path (must be /home/devuser/workspace).
while IFS= read -r hit; do
  echo "RETIRED-PATH $hit"; fail=1
done < <(grep -rInE '(^|[^a-zA-Z0-9_./~-])/workspace/' --include='SKILL.md' . | grep -v '/home/devuser/workspace' | grep -v '\$WORKSPACE')

# 4. Monolith check: SKILL.md > 250 lines with no references/ dir.
for f in */SKILL.md; do
  d=${f%/SKILL.md}
  n=$(wc -l < "$f")
  if [ "$n" -gt 250 ] && [ ! -d "$d/references" ]; then
    echo "MONOLITH $d ($n lines, no references/)"; fail=1
  fi
done

# 5. Frontmatter sanity: file starts with --- and has name + description.
for f in */SKILL.md; do
  head -1 "$f" | grep -q '^---' || { echo "FRONTMATTER $f: missing opening ---"; fail=1; }
  grep -q '^name:' "$f" || { echo "FRONTMATTER $f: missing name:"; fail=1; }
  grep -q '^description:' "$f" || { echo "FRONTMATTER $f: missing description:"; fail=1; }
done

[ "$fail" -eq 0 ] && echo "OK — skills estate clean"
exit "$fail"
