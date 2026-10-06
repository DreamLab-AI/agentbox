---
id: ADR-2131
title: Diagram review runs on a ledgered cadence with a gated, budget-capped Gemini audit
date: 2026-10-06
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: cc5f5dcc02c91f7577f9e5c129c978571b78551c
verified_paths: [skills/sealmap-review/scripts/review-cadence.cjs, skills/sealmap-review/run-cron.sh, skills/sealmap-review/crontab, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: the first month of real Gemini spend (compare ledger cost with the estimate); a change to Gemini or Z.AI pricing; a GLM model change behind [consultants.zai]; the sealmap binary's `stale --since` output format becoming known; a second corpus joining repos
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2130 (external review is a transport outside [model_routing]; seal review is cross-family); ADR-2057 (a supervised program gated on a manifest key); ADR-2053 (Z.AI egress); ADR-039 (honest apply classes); ADR-2122 (a program holds a role only when it holds a secret file)
---

# ADR-2131 — Diagram review runs on a ledgered cadence with a gated Gemini audit

## Context

`sealmap-review` is run by hand. The expensive step, Gemini 3.8 Flash at high thinking over a 140k to 630k token pack, is the one nobody should run on a whim, and the drift it should catch accumulates unseen between runs. GLM on Z.AI is cheap enough to watch every change. Without a rule the choice is a forgotten corpus or an unbounded bill. Local numbering: this repo's last record is ADR-2130 and the host's ledger stops at ADR-2128, so 2131 is free in both.

## Decision

A manifest section `[diagram_review]` gates `[program:diagram-review-cron]`. The shipped `agentbox.toml` sets `enabled = true` (owner decision 2026-10-06), so the program is baked at the next rebuild; the flake's default for a manifest without the section is off: supercronic over `skills/sealmap-review/crontab`, a template that `run-cron.sh` renders at boot from the manifest schedules into `/run/agentbox`. When disabled the flake emits no program block. The runner is `skills/sealmap-review/scripts/review-cadence.cjs`:

- **Repos are discovered, never named in the manifest.** `repos = []` means scan `$WORKSPACE` to depth 3 for `docs/diagrams/<area>/NN-*.md`, skipping `.tmp`, `node_modules`, `target` and dot-directories, one entry per realpath. The manifest is public and the corpora are private, so extra and excluded paths live in the gitignored `config/diagram-review.local`.
- **Change is detected per source repository.** Each cited path is resolved from the corpus root by realpath (a workspace symlink and the real path are one file) and attributed to the innermost git toplevel that owns it (a nested submodule is its own repository, not a gitlink bump in its parent). The ledger keeps a map of last-seen commits per repository. A missing sibling or a dangling link is a logged skip.
- **Reviews are sharded by area** (large areas split at 150k tokens). The pack-hash skip, the change thresholds, the interval and the budget apply per shard; the Gemini gate takes changed shards most-changed first, within budget.

- **Triage (GLM, daily).** A topic is a candidate when a file in its `sources:` changed since the commit recorded for that file's repository by the last triage, computed per file and unioned over the window (`sealmap stale --since` narrows it for a single-repository corpus when the binary exists). One bounded call per candidate asks whether the topic is now wrong; unsure or failed means yes. Output is `docs/review/<date>-triage.md`. Topics are never edited.
- **GLM review (weekly).** The critical and premortem lenses with GLM as reviewer, per shard, skipped when the shard's pack sha256 equals its last GLM review's. High-severity findings are counted in the ledger.
- **Gemini audit (gated, per shard).** A shard runs only when every condition holds: at least `gemini_min_interval_days` (7) since the last audit; at least `gemini_min_changed_topics` (3) topics changed since it, or the last GLM review recorded a high-severity finding; and month-to-date spend plus a `countTokens`-based estimate within `gemini_monthly_usd` (10). A high-severity finding opens the topic condition only, never the interval or the budget.
- **Ledger.** Each repo's `docs/diagrams/review-ledger.jsonl` is append-only, one line per run including every refusal with its reason. Interval, spend and pack-skip decisions are read from it and from nothing else. A failed Gemini generation is booked at its estimate, because a timed-out call may have been billed.
- **Findings** go to `docs/review/<date>-<reviewer>.md` and `.json`, `status: unverified`, for build-with-quality.

Gemini is priced from constants dated 2026-10-06 (input $0.75/M, cached $0.075/M, output including thinking $3.75/M). GLM is billed under the Z.AI plan and counts as zero against the Gemini cap.

## Consequences

- The expensive reviewer is rare by construction, and the cap holds across all configured repos. The cost is a bounded daily GLM bill and findings that arrive without being asked for.
- The estate corpus is about 850k tokens across 139 topics and 16 repositories; sharding keeps each pack inside GLM and Gemini limits at the price of cross-area contradictions being seen by no single reviewer.
- Nothing edits a topic or commits. The runner dirties the reviewed repo with the ledger and `docs/review/` files; the owner commits them.
- The triage window advances every run, so a flagged topic that is not re-authored does not reappear; the triage files are the queue.
- The program holds no secret file, so it takes no ADR-2122 role. It inherits `ZAI_ANTHROPIC_API_KEY` and `GEMINI_API_KEY` from the container environment, as podcast-cron does.
- `enabled` is rebuild-class (baked supervisor text). Schedules, thresholds, budget and repos apply on a program restart.
- `GEMINI_API_KEY` is an uncapped key: the cap is this runner's, not Google's. Anything else spending on it is invisible to the ledger.
- **Rejected:** a daily Gemini audit (cost with no new information); running the gate in the manifest projector (the ledger is per repo and the runner already reads it); a global budget file outside the repos (a second source of truth beside the ledger).

## Verification

`implementation_status: complete` and `activation_status: staged`. At `cc5f5dcc0`: `node --test` in `skills/sealmap-review/scripts` (23 new cases across the gate, pack-hash skip, ledger, triage candidates and subcommands with faked model calls, beside the 14 existing external-review cases), `bash tests/config/diagram-review-cron.test.sh` (15), `semantic-rules.test.js` for `E079`/`W076`, `skills/lint-skills.sh`, the role-isolation suites and `cargo test` in `services/agentbox-manifest`. Not run: `nix flake check` (no Nix in the authoring container), so the supervisor block is checked by text, not evaluation; and no live GLM or Gemini call, so the Messages-API request shape, `sealmap stale --since` parsing and the Gemini price constants are unverified against the real services. The image is unverified until the host `./agentbox.sh rebuild`.
