# Completion audit

Derive the checklist from the actual user's scope, including steering received
mid-task. For each requirement identify the artifact and observation that proves
it. Record incomplete, contradictory or missing evidence as such; do not narrow
the objective to the pages or videos already made.

| Requirement | Evidence to inspect |
|---|---|
| Cold-start teaching | Problem, actors, vocabulary, design rationale and useful independent entry points actually rendered |
| Delivered-state narrative | Chapters, media, captions, screenshots, diagrams and linked evidence explain final behaviour; no remediation diary, finding IDs or before/after fix stories in the reader path |
| Delivery blockers | Required behaviour and its verification work; unresolved blockers prevent dependent delivery and are reported with evidence and the input needed to proceed, not recast as limits |
| Feature/journey coverage | Each requested user/developer journey traced through UI, API/command, state, controls and failure/recovery; omissions explicit |
| Architecture and code | Reviewed diagram relationships, full-file pane, cited lines, source identity and current drift check |
| Quality and security | Fresh scoped commands/results, meaningful failure cases, coverage denominator and excluded/unobserved environments |
| Runtime surfaces | Real captures and actions with mode, input identity and outcomes; synthetic aspects clearly labelled |
| Narrated media | Every requested clip exists and plays; every scene visually inspected, narration listened to, captions and transcript reviewed |
| Corrections (internal audit) | Findings reconciled to fixes and checks; affected explanatory media refreshed to describe the final product without remediation history |
| Normal-clone delivery | All required media/source present in a clean copy, no ignored intermediates or external runtime dependency referenced |
| Site interaction | Links, code switching and line targets, back/forward navigation, errors, keyboard/focus, desktop/mobile and readable screenshots |
| Reader voice | `scripts/voice-lint.sh` at `hits=0` on every chapter source; no process narration, evidence vocabulary, fix history, hedges, trust adjectives or media provenance in reader text (`reader-voice.md`) |
| Link ranges | the target build green (paths exist, ranges inside files, chapter links in the map) and an independent checker's pass on every `src:` range supporting its sentence |
| Anatomy coverage | `scripts/anatomy-coverage.mjs` reports every source directory, route, compose service and design record mentioned by some chapter, or lists the deliberate omissions |
| Reproduction | Build/serve instructions and durable production inputs sufficient for another developer; no accidental secrets or unrelated artifacts |

A complete review includes representative negative paths, not just a successful
happy path. Match proof to claim: a browser screenshot does not prove persistence,
a mocked HTTP test does not prove a deployed proxy, and line coverage does not
prove freedom from vulnerabilities.

If final deployment equivalence matters, obtain build/image/runtime provenance
and reconcile it with the source snapshot. Without that evidence, identify the
pane as checkout/review source, not deployed source.
