---
id: ADR-2143
title: Source supply is plumbing, not a decision; every operator question is four plain-English fields
date: 2026-10-17
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 2305d675e4a532f8091079deb5efcd4fa474085e
verified_paths: [services/dream-engine/src/wanted.rs, services/dream-engine/src/engine.rs, services/dream-engine/src/inbox.rs, services/dream-engine/src/governance.rs, services/dream-engine/src/prompt/nightly.tmpl, services/dream-engine/Cargo.toml]
owner: jjohare
review_trigger: a change to the nightly prompt's Human-action shape, to the wanted store's expiry, to dream-core's requested-source contract (ADR-DE-008), or a governance case that again asks the operator for a file
repo: agentbox
---

# ADR-2143 — Source supply is plumbing, not a decision; every operator question is four plain-English fields

## Context
On 2026-10-17 the forum governance panel (ADR-2115) held 57 open cases. Nine of them asked the human to "bundle", "re-supply" or "inline" named source files for the next night, several for the third time, and most of the rest were phrased in engine words ("if ACCEPT is upheld, review the draft PR (evaluation-is-not-promotion)", "deep", "annexe", "ledger row") with no statement of what approving would change. Two causes: the tree-read planner (ADR-2114) never saw the previous night's unmet source request, so the engine forwarded its own file list to a person; and the prompt put no shape on **Human action recommended**.

## Decision
1. **Requested sources go back to the tree-read, never to the panel.** dream-core 0.2.0 (ADR-DE-008 in that repo) reads requested paths first, capped at half the file slots and half the byte budget, validated like planner picks, directories expanded to their files. The engine (`wanted.rs`) feeds it from the previous night's **Sources wanted next night** list and from any Human-action line whose verb is supply/inline/bundle and which names a path; such a line is not queued as a question. A slot's path-shaped `scan` entries are offered after the explicit requests, so on a quiet night they take the reserved half of the read; that is intended (the deep's declared scope is always in front of the model), and topic-word scans are left to the prompt. A request is keyed on (repo, deep, path[:range]); it lapses once inlined (`source.json`) or after three unmet nights; a path asked for again after it was read raises one alert and is not re-armed. Store: `$WORKSPACE/.agentbox/dream-source-requests.json`.
2. **Every operator question is one line in four labelled fields:** `Decision: … · Why: … · If approved: … · If not: …`, in plain words, no engine jargon; the prompt says so (step 14 of `nightly.tmpl`) and the final report carries the new **Sources wanted next night** list. `inbox::decision_fields` parses the fields with any separator; `plain_decision` rewrites an *If approved* that promises a merge, promotion, ship, deploy, release or publish, because approval never merges anything (evaluation is not promotion). The panel (`governance.rs`) renders the four fields as labelled lines and titles the case by its Decision; a question without the fields renders as before.
3. The engine pins `dream-core = "=0.2.0"` and `dream-gate = "=0.2.0"` (rebuild-class; ADR-2141 review trigger fired).

## Consequences
- The panel shows decisions only. The operator sees a source request only as the loop alert in (1), which means the night is asking for the wrong window or something else blocks it.
- A reviewer who did not watch the night can read what is asked, why, and what each answer does, without the engine's vocabulary.
- Prompt golden fixture updated; 160 unit tests and the end-to-end night pass against 0.2.0.
- One-off migration on 2026-10-17: the nine open source-supply cases were turned into store entries and closed as superseded.
