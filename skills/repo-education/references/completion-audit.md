# Completion audit

Derive the checklist from the actual user's scope, including steering received
mid-task. For each requirement identify the artifact and observation that proves
it. Record incomplete, contradictory or missing evidence as such; do not narrow
the objective to the pages or videos already made.

| Requirement | Evidence to inspect |
|---|---|
| Cold-start teaching | Problem, actors, vocabulary, design rationale and useful independent entry points actually rendered |
| Feature/journey coverage | Each requested user/developer journey traced through UI, API/command, state, controls and failure/recovery; omissions explicit |
| Architecture and code | Reviewed diagram relationships, full-file pane, cited lines, source identity and current drift check |
| Quality and security | Fresh scoped commands/results, meaningful failure cases, coverage denominator and excluded/unobserved environments |
| Runtime surfaces | Real captures and actions with mode, input identity and outcomes; synthetic aspects clearly labelled |
| Narrated media | Every requested clip exists and plays; every scene visually inspected, narration listened to, captions and transcript reviewed |
| Corrections | Findings reconciled to fixes and checks; affected explanatory media refreshed |
| Normal-clone delivery | All required media/source present in a clean copy, no ignored intermediates or external runtime dependency referenced |
| Site interaction | Links, code switching and line targets, back/forward navigation, errors, keyboard/focus, desktop/mobile and readable screenshots |
| Reproduction | Build/serve instructions and durable production inputs sufficient for another developer; no accidental secrets or unrelated artifacts |

A complete review includes representative negative paths, not just a successful
happy path. Match proof to claim: a browser screenshot does not prove persistence,
a mocked HTTP test does not prove a deployed proxy, and line coverage does not
prove freedom from vulnerabilities.

If final deployment equivalence matters, obtain build/image/runtime provenance
and reconcile it with the source snapshot. Without that evidence, identify the
pane as checkout/review source, not deployed source.
