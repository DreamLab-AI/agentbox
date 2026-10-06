# Scheduled review: detail

ADR-2131. The cadence runs `scripts/review-cadence.cjs` from a supercronic
crontab. It reviews every repo in `[diagram_review].repos` that has a
`docs/diagrams` corpus. Nothing in it edits a topic or commits a file.

## Manifest

```toml
[diagram_review]
enabled = false                      # rebuild-class: flake.nix bakes the supervisor block
repos = []                           # absolute paths of repos with docs/diagrams
glm_triage_cron = "17 5 * * 1-6"     # daily GLM triage (UTC)
glm_review_cron = "47 5 * * 0"       # weekly GLM review, then the Gemini gate
gemini_min_interval_days = 7
gemini_min_changed_topics = 3
gemini_monthly_usd = 10
weekly_window = true                 # Gemini gate only on the weekly tick
```

`enabled` decides whether `[program:diagram-review-cron]` exists, so flipping it
needs `./agentbox.sh rebuild`. Every other key is read when the program starts
(the wrapper) and on every run (the runner), so a change applies on restart.
Validator: `E079` for a relative repo or a malformed cron, `W076` for enabled
with no repos.

## How the crontab is made

`crontab` is a template. `run-cron.sh` reads the two schedules and
`weekly_window` with `agentbox-manifest toml-string|toml-bool`, fills the
placeholders, writes `/run/agentbox/diagram-review.crontab` (tmpfs) and execs
supercronic on it. A cron expression that is not five fields of cron characters
is refused with a line on stderr and the default is used, so a typo cannot inject
shell into a job. The supervisor `command=` carries the supercronic store path;
the rendered file never does.

With `weekly_window = true` the audit runs after `review-glm` on the weekly tick.
With `false` it is also tried after each triage. The interval and budget gates
apply either way, so this changes how often the gate is read, not how often
Gemini is paid.

## Subcommands

```bash
C=skills/sealmap-review/scripts/review-cadence.cjs
node $C triage|review-glm|audit-gemini|status [--manifest f] [--repo dir]... [--dry-run] [--now ISO]
```

`--repo` overrides the manifest list and runs even when `enabled` is false (for a
manual run). `--dry-run` decides and prints; it writes no ledger line and calls no
model. Exit 1 when any repo failed; a refusal is not a failure.

### triage

1. The window starts at the commit recorded by the last triage line. The first run
   records HEAD and spends nothing (reason `baseline`). A recorded commit missing
   from the repo re-baselines the same way.
2. A topic is a candidate when any file in its `sources:` appears in
   `git diff --name-only <commit> HEAD`: a per-file test, unioned over the whole
   window. A `../` source belongs to another repo and is not attributed.
   When a `sealmap` binary is on PATH, `sealmap stale --since <commit>` narrows the
   set; if it is absent, fails or names no known topic, the git set is used.
3. Each candidate gets one GLM call: the topic text plus the combined `git diff` of
   its changed sources, each bounded (60 kB topic, 40 kB diff). The answer is
   `VERDICT: YES|NO`. Anything but a clear NO is YES, and so is a failed call. At
   most 60 topics are asked per run; the rest are listed unchecked.
4. `docs/review/<date>-triage.md` lists the topics to re-author, then those found
   accurate. The window advances to HEAD even when nothing is flagged, so the
   triage files are the work queue: a topic listed and not re-authored does not
   reappear in the next triage.

### review-glm

The pack is built exactly as `external-review.cjs` builds it. If its sha256 equals
the last successful GLM review, the run is skipped and logged. Otherwise the
critical and premortem lenses run with a line appended asking for
`- Severity: high, medium or low`. A pack over about 150k tokens is reviewed one
area at a time. Output: `docs/review/<date>-glm.md` and `.json`, each finding
`status: "unverified"`. A finding counts as high severity when it says
`Severity: high`, or, with no severity line, when it has `Confidence: high` and
the authors had not marked it. The count goes in the ledger line.

Transport: the Anthropic Messages API at `ZAI_URL` (`/v1/messages`), with the key
from `ZAI_ANTHROPIC_API_KEY` then `ZAI_API_KEY`, following
`mcp/consultants/shared/zai-env.js`. The model is `[consultants.zai].model`
(`DIAGRAM_REVIEW_GLM_MODEL` overrides). The key goes in an `Authorization` header
only and is never printed, logged or written.

### audit-gemini

All of these must hold, checked in this order; the first that fails is the
logged reason.

1. At least `gemini_min_interval_days` since the last completed audit (none yet
   means the interval is clear).
2. At least `gemini_min_changed_topics` topics changed since the last audit's
   commit (all topics when there was none), or the last GLM review recorded a
   high-severity finding.
3. Month-to-date Gemini spend across all configured repos plus the estimate for
   this run is within `gemini_monthly_usd`. A high-severity finding never
   overrides the budget.

The estimate comes from a free `countTokens` call: the pack once at the input
rate, once more per extra lens at the cached rate, plus an assumed 30,000 output
and thinking tokens per lens. The run itself is `external-review.cjs`; the ledger
records the cost from the usage it reports.

Prices (USD per million tokens), constants at the top of `review-cadence.cjs`,
Gemini 3.8 Flash as given on 2026-10-06 and not re-checked against the live
pricing page: input 0.75, cached input 0.075, output including thinking 3.75.
GLM runs under the Z.AI plan and counts as 0, so it never uses the Gemini cap.

A failed `generateContent` is booked at its estimate and counts toward the month,
because a timed-out call may already have been billed. It does not reset the
interval. External review never retries a billable call, and neither does this.

## Ledger

`docs/diagrams/review-ledger.jsonl` in each repo, append-only, one JSON line per
run. Fields: `ts`, `kind` (`triage`, `review`, `audit`), `reviewer` (`glm`,
`gemini`), `commit`, `pack_sha256`, `tokens`, `est_usd`, `findings` (path),
`high_severity`, `changed_topics`, `skipped` (the reason, or null), plus `error`
on a failed call. A torn line is skipped on read. `node $C status` summarises it.
Commit the ledger with the corpus, or ignore it, as the repo prefers: the runner
only appends.

## Operating notes

- The cron needs `ZAI_ANTHROPIC_API_KEY` (or `ZAI_API_KEY`) and `GEMINI_API_KEY`
  in the container environment (`.env`). Without the Gemini key an audit is logged
  as skipped; without the Z.AI key triage lists every candidate (unsure means yes)
  and the GLM review fails.
- Logs: `/var/log/diagram-review-cron.log` and `.error.log`.
- Findings are input to build-with-quality like any others; see "After the review"
  in SKILL.md.
