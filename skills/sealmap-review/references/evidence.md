# Evidence: what holds and what does not

Outcome of the sealmap evidence programme (experiments pre-registered, results
in the sealmap repository). Read this before changing how a corpus is kept
fresh, how it is reviewed, or what a checker prompt asks. Base URL:
`https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/`.

## What works

| Finding | Evidence |
|---|---|
| A corpus is a cheap whole-system review artefact, and generated views (Mermaid, `dense`) of the code found about a dozen real Rust bugs that tests missed (wrong or missing call edges, resolver faults) | dogfooding notes in [consult/2026-10-06-codex.md](https://github.com/DreamLab-AI/sealmap/blob/main/docs/evidence/consult/2026-10-06-codex.md) |
| Upkeep that works: per-file git flags, batched weekly (−88.2% re-checks), then model triage. Sonnet 5.5 recall 0.93, GLM-5.3-Flash 0.86. **Haiku 0.38 is unfit.** | [EH](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/EH) |
| Critical and pre-mortem lenses remove the flattery an open prompt produces | [external-review.md](external-review.md) (pilot), consult notes |
| Mixed diagram kinds carry more review signal than sequence diagrams alone | [EK](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/EK) |

## What does not

| Finding | Evidence | Consequence here |
|---|---|---|
| Every deterministic staleness narrowing loses real changes: symbol 0.76 recall, region 0.66, call-flow 0.45, line-overlap (k=5) 0.38. Only per-file flagging keeps recall 1.0 (precision 0.48) | [E0](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/E0) (symbol), [E0b](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/E0b) (region), [E0c](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/E0c) (call-flow), [E0d](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/E0d) (line-overlap) | Triage flags | Triage flags per file only; precision comes from the model call |
| Sequence-only corpora fail: deleting the other kinds loses review signal | [EK](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/EK) | Keep mixed kinds; do not convert flowcharts, class or state diagrams to sequence |
| Rewriting into sequence diagrams invents facts: 14 of 15 invented claims were an order or concurrency the original never stated | [ES](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/ES), [ES2](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/ES2) | A sequence diagram asserts order; lenses and gates say so (below) |
| A corpus pack did not beat full source for review when the source fits in context (three reviewer families) | [ER](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/ER) | Use the corpus when source does not fit; otherwise read the source |
| External reviewers mostly re-rank a visible register. Register-stripped runs rediscover about 30% of known issues and miss Open questions entirely | [ER](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/ER), [EH](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/EH), [consult](https://github.com/DreamLab-AI/sealmap/blob/main/docs/evidence/consult/2026-10-06-codex.md) | Included-register runs triage; stripped runs judge the corpus; neither finds Open questions |
| Stale corpus prose produces false findings | [ER](https://github.com/DreamLab-AI/sealmap/tree/main/docs/evidence/ER) (a stale-corpus false finding is recorded in the adjudication) | Triage and re-stamp before an expensive audit |

## Practices that follow

- **Agreement ranks.** When two model families reviewed the same pack, findings
  both raised independently go first (`node scripts/review-cadence.cjs merge`,
  or `scripts/merge-findings.cjs a.json b.json`). Agreement is a ranking signal,
  not verification.
- **Lens and gate prompts state the order rule.** "Only report what the material
  states or directly implies; if a diagram's order or concurrency is unstated,
  do not treat it as asserted."
- **Gates are explicit checks.** Any fidelity gate or checker prompt applies its
  rules as checks the model lists, for example "list every ordering or
  concurrency the original does not state; any entry fails". A prompt that says
  only "be faithful" lets the model rewrite instead of check.
- **Do not narrow.** No symbol, region, call-flow or line-overlap filter sits
  between a git change and a triage call.
