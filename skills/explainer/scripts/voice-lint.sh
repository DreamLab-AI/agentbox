#!/usr/bin/env bash
# Reader-voice lint for explainer chapters (Markdown or HTML).
# Fails when the text talks about its own making, its evidence, or its fixes instead of
# the system it explains. Exit 1 on any hit. Usage: voice-lint.sh file...
set -u
rc=0
SELF='\b(this (pack|chapter|walkthrough|guide|page|site|section|explainer|curriculum)|the reader|reading pack|curriculum)\b'
EVID='\b(evidence|receipts?|recorded|observed|verified|verification of this|checkpoint|export(ed)?|hash(es|ed)?|provenance|drill|fixture|demonstration|demonstrat(es|ed)|reproduce|reproducible)\b'
HIST='\b(earlier regression|was corrected|after the fix|before the fix|now (works|passes)|F0[0-9]{2}|finding [0-9]+|remediat(ion|ed))\b'
HEDGE='\b(does not (itself )?(establish|prove)|cannot prove|this alone did not|is not proof|actually (runs|does|happens)|what this really)\b'
TRUST='\b(the (actual|real) [a-z]+|actual [a-z]+ (output|gate|executor|renderer|browser|check)|real (browser|renderer|components?|evidence))\b'
MEDIA='\b(narrat(ion|ed|or)|caption|transcript|video|clip|screenshot|recording|bm_[a-z]+)\b'
SLOP='—|\b(delve|delving|seamless(ly)?|robust(ly)?|leverage[sd]?|leveraging|worth noting|it is important to note|tapestry|game-changer|cutting-edge|unlock|dive into|deep dive)\b'
for f in "$@"; do
  text=$(sed -e 's/<[^>]*>/ /g' "$f")
  total=0
  for name in SELF EVID HIST HEDGE TRUST MEDIA SLOP; do
    pat=${!name}
    n=$(printf '%s' "$text" | grep -oiE "$pat" | wc -l)
    total=$((total+n))
    [ "$n" -gt 0 ] && printf '  %-6s %3d  %s\n' "$name" "$n" "$(printf '%s' "$text" | grep -oiE "$pat" | sort | uniq -c | sort -rn | head -4 | awk '{$1=$1};1' | paste -sd';' -)"
  done
  words=$(printf '%s' "$text" | wc -w)
  printf '%s: words=%s hits=%s\n' "$f" "$words" "$total"
  [ "$total" -gt 0 ] && rc=1
done
exit $rc
