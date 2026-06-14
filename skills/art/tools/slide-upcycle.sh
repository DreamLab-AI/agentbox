#!/bin/bash
# Upcycle all 10 Beamer slides via Nano Banana Pro (2K), metaprompt + per-slide data.
cd "${SLIDE_DIR:-$PWD}"
NB=/home/devuser/workspace/project/agentbox/skills/art/tools/nb-generate.cjs
META=$(cat "${METAPROMPT:-slide-upcycle-metaprompt.txt}")
SIZE=${1:-2K}
mkdir -p slides-up

addendum() {
  case "$1" in
    04) echo 'DIAGRAM SLIDE — keep the architecture: a "Knowledge Graph (Oxigraph + Whelk, 4,196 classes, 222k inferred)" box, an arrow to a central "One retrieval brain — ontology_ask, budget-bounded, fail-open" box, which branches with arrows to two boxes: "PUSH — per-turn breadcrumb" and "PULL — subgraph on demand". Keep the two bullets: read-pervasive (every agent/turn can consult the KG) and write-governed (proposals auth-gated and queued; derived facts fenced).';;
    06) echo 'BAR CHART — title "Result: every model wins", y-axis "Mean F1" 0..1. Groups: Opus 4.8 (teal 0.81, orange 0.39), Sonnet 4.6 (0.85, 0.35), Haiku 4.5 (0.82, 0.27), Gemini 2.5 Pro (0.78, 0.47), GLM-5.2 (0.82, 0.36). Legend: teal=Ontology-augmented, orange=Control (parametric only). Caption: "Universal lift: +0.31 to +0.54 F1. The smallest model (Haiku) gains the most."';;
    07) echo 'BAR CHART — title "Result: hallucination roughly halved", y-axis "Hallucination rate" 0..1. Groups: Opus 4.8 (teal 0.15, orange 0.57), Sonnet 4.6 (0.12, 0.59), Haiku 4.5 (0.07, 0.76), Gemini 2.5 Pro (0.13, 0.55), GLM-5.2 (0.14, 0.64). Legend: teal=Ontology-augmented, orange=Control.';;
    08) echo 'BAR CHART — title "Where grounding helps most", y-axis "Mean F1 (all models)" 0..1. Groups: neighbour (teal 0.92, orange 0.46), subclass (0.55, 0.05), existence (0.87, 0.51). Legend: teal=Augmented, orange=Control.';;
    *) echo '';;
  esac
}

for i in 01 02 03 04 05 06 07 08 09 10; do
  add=$(addendum "$i")
  PROMPT="$META"
  [ -n "$add" ] && PROMPT="$META

$add"
  node "$NB" --prompt "$PROMPT" --out "slides-up/slide-$i.jpg" --model gemini-3-pro-image --size "$SIZE" --aspect 4:3 --ref "slides/slide-$i.png" 2>&1 | sed "s/^/[$i] /"
done
echo "UPCYCLE DONE ($SIZE)"
