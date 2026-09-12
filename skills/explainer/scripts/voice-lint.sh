#!/usr/bin/env bash
# Reader-voice lint for explainer chapters (Markdown or HTML).
# Fails when the text talks about its own making, its evidence, or its fixes instead of
# the system it explains. Exit 1 on any hit.
#
#   voice-lint.sh [--allow FILE] file...
#
# --allow names an engagement's product vocabulary: one phrase per line, blank lines and
# # comments ignored. Each phrase is removed from the text before matching, so a product
# whose features genuinely include an audit hash chain, a checkpoint or a published video
# can name them. Phrases, not bare words: allowing "audit hash chain" keeps "hash" banned
# everywhere else, which is the point. Without it the lint rejects a product's own terms
# and the writer learns to avoid true sentences (measured 2026-09-10).
set -u
rc=0
allow_file=
while [ $# -gt 0 ]; do
  case "$1" in
    --allow) allow_file=$2; shift 2;;
    --allow=*) allow_file=${1#--allow=}; shift;;
    *) break;;
  esac
done
if [ -n "$allow_file" ] && [ ! -f "$allow_file" ]; then echo "voice-lint: --allow file not found: $allow_file" >&2; exit 2; fi
# A chapter must not narrate its own making, but it may point at its own media: "watch this
# chapter as a film" is navigation, not process narration, and a pack whose contract requires
# a clip per chapter cannot link to one without naming it. grep -E has no lookahead, so the
# sanctioned sentence is removed before matching rather than excepted inside the pattern.
MEDIA_LINK='[Ww]atch (this|the) (chapter|section)[^.]{0,80}\.'
SELF='\b(this (pack|chapter|walkthrough|guide|page|site|section|explainer|curriculum)|the reader|reading pack|curriculum)\b'
EVID='\b(evidence|receipts?|recorded|observed|verified|verification of this|checkpoint|export(ed)?|hash(es|ed)?|provenance|drill|fixture|demonstration|demonstrat(es|ed)|reproduce|reproducible)\b'
HIST='\b(earlier regression|was corrected|after the fix|before the fix|now (works|passes)|F0[0-9]{2}|finding [0-9]+|remediat(ion|ed))\b'
HEDGE='\b(does not (itself )?(establish|prove)|cannot prove|this alone did not|is not proof|actually (runs|does|happens)|what this really)\b'
TRUST='\b(the (actual|real) [a-z]+|actual [a-z]+ (output|gate|executor|renderer|browser|check)|real (browser|renderer|components?|evidence))\b'
MEDIA='\b(narrat(ion|ed|or)|caption|transcript|video|clip|screenshot|recording|bm_[a-z]+)\b'
SLOP='—|\b(delve|delving|seamless(ly)?|robust(ly)?|leverage[sd]?|leveraging|worth noting|it is important to note|tapestry|game-changer|cutting-edge|unlock|dive into|deep dive)\b'
for f in "$@"; do
  # Strip HTML tags, fenced code, inline code spans and Markdown link targets: identifiers such as
  # a route named /screenshot or a file called evidence.ts are code, not prose.
  text=$(sed -e 's/<[^>]*>/ /g' "$f" | awk '/^```/{f=!f;next} !f' | sed -E 's/`[^`]*`/ /g; s/\]\([^)]*\)/]/g')
  words=$(printf '%s' "$text" | wc -w)
  text=$(printf '%s' "$text" | sed -E "s/$MEDIA_LINK/ /g")
  if [ -n "$allow_file" ]; then
    while IFS= read -r phrase; do
      case "$phrase" in ''|'#'*) continue;; esac
      text=$(printf '%s' "$text" | sed -E "s/$(printf '%s' "$phrase" | sed -e 's/[][\.*^$(){}?+|/]/\\&/g')/ /Ig")
    done < "$allow_file"
  fi
  total=0
  for name in SELF EVID HIST HEDGE TRUST MEDIA SLOP; do
    pat=${!name}
    n=$(printf '%s' "$text" | grep -oiE "$pat" | wc -l)
    total=$((total+n))
    [ "$n" -gt 0 ] && printf '  %-6s %3d  %s\n' "$name" "$n" "$(printf '%s' "$text" | grep -oiE "$pat" | sort | uniq -c | sort -rn | head -4 | awk '{$1=$1};1' | paste -sd';' -)"
  done
  printf '%s: words=%s hits=%s\n' "$f" "$words" "$total"
  [ "$total" -gt 0 ] && rc=1
done
exit $rc
