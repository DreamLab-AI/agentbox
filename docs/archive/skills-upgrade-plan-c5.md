Fully executed 2026-08-21 — retained as rationale record; see SKILL-DIRECTORY.md

# Prioritized Skill-Upgrade Plan — Claude-5 Augment Phase

*Produced by the skill-audit swarm (11 agents, 118 skills) against Anthropic's
"new rules of context engineering for Claude-5-generation models", 2026-07-28.*

## 1. Executive summary
Of 118 skills audited, ~49 need work (19 high, ~30 medium) and ~55 are already
compliant. Health is fundamentally sound — most skills are trigger-led and
proportionate — but two systemic failures dominate. **(a) Oversized monoliths:** 25
skills exceed the ~400-line budget, seven of them 700–1156 lines, dumping entire
catalogs inline instead of using progressive disclosure. The `github-*` family (four
files, 1080–1156 lines each) is the single worst cluster. **(b) Description-surface
pollution:** ~25 descriptions carry marketing hype, benchmark stats, or keyword/tool
enumerations on the JIT routing surface where only what+when triggers belong. A
smaller unhobble tail (~11 skills) bakes rigid never/always governance into prose.

## 2. Dual-path set (do first)
| skill | why | action |
|-------|-----|--------|
| build-with-quality | most-used, 615 lines | Split into lean guide; push detail into existing EDD-PROTOCOL / DEBUGGING-PROTOCOL / USAGE-EXAMPLES refs (present, unused). |
| docs-alignment | most-used, 363 lines, bloated desc | Strip "enterprise-grade/100%/production-ready"; trigger-led one-liner. |
| codebase-memory | most-used, 184 lines | Drop token-count boast; add quick-path + on-demand reference tier. |
| skill-router | most-used, 271 lines, duplication | Extract the 226-line routing table (duplicates every skill's description → drift-prone) to a generated on-demand reference. |
| perplexity-research | most-used, 327 lines | Move three-API parameter tables to references/; keep quick-path. |
| deep-research | most-used, 204 lines | Add quick-path/reference two-tier. |
| design-audit | most-used, 163 lines | Split flat file into quick-path + on-demand rubric reference. |
| browser | most-used, 150 lines, duplication | Own the canonical sidecar block; the other three browser skills reference it. |
| leptos / qe-browser / playwright | exemplary | **Keep as-is** — the reference two-tier pattern. |

## 3. Trim set — oversized SKILL.md (>400 lines) to split
github-code-review 1156 · sparc-methodology 1125 · github-release-management 1096 ·
github-workflow-automation 1080 · latex-documents 924 · github-multi-repo 883 ·
comfyui 865 · human-architect-mindset 801 · game-dev 746 · hive-mind-advanced 735 ·
prd2build 696 · agentic-jujutsu 672 · verification-quality 657 · agentdb-advanced 624 ·
build-with-quality 615 · performance-analysis 571 · stream-chain 570 · mermaid-diagrams
509 · prose-sanitiser 479 · codeact 451 · lichtfeld-studio 448 · meta-xr-sdk 442 ·
renaissance-architecture 424 · report-builder 420.
Split into a thin guide + on-demand reference; prefer runnable scripts over inline
examples. `github-workflow-automation` even claims `progressive_disclosure:true` while
dumping 1080 lines — honour the claim.

## 4. Unhobble set — rigid rules to relax
bencium-controlled-ux-designer, typography (38 absolutes + scrambled desc), github-multi-repo,
ceramic-search ("PRIMARY/DEFAULT for all web search"), open-design (phase gates),
relationship-design, ruvector-catalog, ruvnet-brain, renaissance-architecture,
payment-router (keep genuine payment-safety, cut the rest), negentropy-lens.

## 5. Description rewrites — the fix in a phrase
**Bloated (strip stats/enums → body):** agentic-jujutsu, codeact, mermaid-diagrams,
clipcannon, ui-ux-pro-max-skill, lazy-fetch, report-builder, voyager-skill-library,
expel-lesson-extractor, email-search, prose-sanitiser, architecture-studio,
agentdb-advanced, meta-xr-sdk, uk-solar-planner.
**Vague (add distinct triggers):** payment-router, pytorch-ml, ontology-core/enrich,
openai-codex, jupyter-notebooks, adaptive-communication, browser-automation.
**Dedupe cluster:** browser / browser-automation / chrome-cdp / playwright restate the
same sidecar block — canonical in `browser`, the other three cross-reference.
**Minor:** flow-nexus-{neural,platform,swarm} "NOT INSTALLED" stated twice; hooks-automation
non-kebab name field.

## 6. Clean skills — no action (~55)
Exemplars to model the rest on: **ontology-augment, pdf-signing, leptos, qe-browser,
token-audit, wardley-maps, toprank**. Do not touch these.

## 7. Execution order (disjoint dirs within a batch → parallel-safe)
- **Batch 0** — description-only rewrites (fastest, highest routing ROI). §5 skills not
  being split, + the browser dedupe cluster (one agent for the canonical block).
- **Batch 1** — most-used dual-path restructures (§2). skill-router LAST (its table must
  reflect the finalized descriptions).
- **Batch 2** — the `github-*` mega-split cluster (one owner-agent for a shared reference
  convention + the multi-repo policy-doc extraction).
- **Batch 3** — remaining oversized splits (§3), fully parallel; fold each skill's own
  unhobble/description fix into the same pass.
- **Batch 4** — pure unhobble (§4 remainder).
- **Gate** after Batch 0 and Batch 3: regenerate skill-router's table + re-check routing.
