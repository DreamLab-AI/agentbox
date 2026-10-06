# Scheduled review: detail

ADR-2131. The cadence runs `scripts/review-cadence.cjs` from a supercronic
crontab. It reviews every repo in `[diagram_review].repos` that has a
`docs/diagrams` corpus. Nothing in it edits a topic or commits a file.

## Which repos

`[diagram_review].repos = []` (the shipped value) means **auto-discover**:

1. Scan `$WORKSPACE` (default `/home/devuser/workspace`) to depth 3 for a directory
   with `docs/diagrams/<area>/NN-*.md` topic files.
2. Skip `.tmp`, `node_modules`, `target` and dot-directories.
3. One entry per realpath. A symlink and its target are one repository, and a
   symlink cycle ends.
4. Optional, gitignored `config/diagram-review.local`: one absolute path per line,
   `#` comments; a leading `!` excludes a path (by realpath). Lines add to the
   discovered list. A non-empty manifest `repos` replaces discovery as the base.

The manifest is public and the corpora live in private repositories, so no path
belongs in `agentbox.toml`. `status` prints the resolved list and where it came from.

## Manifest

```toml
[diagram_review]
enabled = true                       # rebuild-class: flake.nix bakes the supervisor block
repos = []                           # empty = auto-discover (above)
glm_triage_cron = "17 5 * * *"       # daily GLM triage (UTC)
glm_review_cron = "47 2 * * *"       # nightly GLM review (after the 01:00 dream window), then the Gemini gate
gemini_min_interval_days = 7
gemini_min_changed_topics = 3
gemini_monthly_usd = 10
weekly_window = true                 # Gemini gate only on the review tick
```

`enabled` decides whether `[program:diagram-review-cron]` exists, so flipping it
needs `./agentbox.sh rebuild`. (The flake's own default for a manifest with no
section is off; the shipped manifest sets true.) Every other key is read when the
program starts (the wrapper) and on every run (the runner), so a change applies on
restart. Validator: `E079` for a relative repo or a malformed cron.

## Many repositories, one corpus

An estate corpus cites files in many repositories, as `../<repo>/...` from the
corpus repo root. Change detection is per source repository:

1. Each `sources:` path is resolved from the corpus repo root and normalised by
   **realpath**. `../agentbox/x` through a workspace symlink and
   `../project/agentbox/x` are one file, counted once.
2. It is attributed to the **innermost git toplevel** of its directory
   (`git rev-parse --show-toplevel`), never by the first path segment. A nested
   submodule (a gitlink in its parent) is its own repository, so its changes are
   read from its own history, not from the parent where they show only as a gitlink
   bump. Toplevels are cached per directory.
3. "Changed" is `git diff --name-only <last commit> HEAD` in that repository. The
   ledger records `commits`, a map of repository to last-seen commit, on every
   triage and audit line.
4. A repository with no recorded commit (new, or its commit is gone) is a baseline:
   its commit is recorded and nothing is flagged on its account that run.
5. A missing sibling repository or a dangling link is a logged skip (counted in the
   ledger line and in `status`), never a crash. A cited file that was deleted is still
   attributed through its nearest existing directory, so the deletion counts as a change.

`status` also lists the repositories a corpus cites, and notes where one has its own
corpus (reviewed separately: its areas and the estate's areas are different topics).

## Shards

Reviews are not whole-corpus. Packs are built **per area** (the first path segment under
`docs/diagrams`); an area over the shard budget (150,000 tokens, `DIAGRAM_REVIEW_SHARD_TOKENS`)
is split into consecutive chunks named `area`, `area#2`, and so on; one topic over the budget
gets a chunk of its own. The same shards feed GLM and Gemini, so "the last GLM review of this
shard" is well defined. The pack-hash skip, the change thresholds, the interval and the budget
all apply per shard, and the ledger lines carry `shard`. A whole-estate pack (about 850k tokens)
would sit at Gemini's limit and over GLM's; the cost of sharding is that a contradiction between
two areas is not seen by one reviewer, which is what the estate area and the nightly cadence are for.

## How the crontab is made

`crontab` is a template. `run-cron.sh` reads the two schedules and
`weekly_window` with `agentbox-manifest toml-string|toml-bool`, fills the
placeholders, writes `/run/agentbox/diagram-review.crontab` (tmpfs) and execs
supercronic on it. A cron expression that is not five fields of cron characters
is refused with a line on stderr and the default is used, so a typo cannot inject
shell into a job. The supervisor `command=` carries the supercronic store path;
the rendered file never does.

With `weekly_window = true` the audit runs after `review-glm` on the review tick (nightly by default).
With `false` it is also tried after each triage. The per-shard interval and the budget
apply either way, so this changes how often the gate is read, not how often Gemini is
paid: a shard is audited at most once per `gemini_min_interval_days`.

GLM is treated as effectively free, so both GLM passes run daily. Repeated refusals of
the same kind for a shard (and repeated "pack unchanged" skips) are written to the ledger
once, not every night.

## Subcommands

```bash
C=skills/sealmap-review/scripts/review-cadence.cjs
node $C triage|review-glm|audit-gemini|status [--manifest f] [--repo dir]... [--dry-run] [--now ISO]
```

`--repo` (repeatable) overrides discovery and runs even when `enabled` is false (for a
manual run); `--workspace` changes the scan root. `--dry-run` decides and prints; it writes no ledger line and calls no
model. Exit 1 when any repo failed; a refusal is not a failure.

### triage

1. The window for each source repository starts at the commit the last triage line
   recorded for it. The first run records every repository's HEAD and spends nothing
   (reason `baseline`).
2. A topic is a candidate when any file in its `sources:` appears in its own
   repository's `git diff --name-only <commit> HEAD`: a per-file test, unioned over the
   whole window (see "Many repositories"). This is the only narrowing: every
   deterministic narrower (symbol, region, call-flow, line-overlap) lost real changes
   in measurement, so none is applied (see [evidence.md](evidence.md)).
3. Each candidate gets one GLM call: the topic text plus the combined `git diff` of
   its changed sources (each repository diffed from its own commit), each bounded
   (60 kB topic, 40 kB diff). Candidates are asked most-changed-first. The answer is
   `VERDICT: YES|NO`. Anything but a clear NO is YES, and so is a failed call. At
   most 60 topics are asked per run; the rest are listed unchecked.
4. `docs/review/<date>-triage.md` lists the topics to re-author, then those found
   accurate. The window advances to HEAD even when nothing is flagged, so the
   triage files are the work queue: a topic listed and not re-authored does not
   reappear in the next triage.

### review-glm

Each shard's pack is built exactly as `external-review.cjs` builds it. If its sha256
equals that shard's last successful GLM review, the shard is skipped and logged.
Otherwise the critical and premortem lenses run with a line appended asking for
`- Severity: high, medium or low`. A failing shard is recorded and the others still
run; the command then exits 1. Output: one `docs/review/<date>-glm.md` and `.json` for
the run, each finding `status: "unverified"` with its shard in the id. A finding counts
as high severity when it says `Severity: high`, or, with no severity line, when it has
`Confidence: high` and the authors had not marked it. The count goes in each shard's
ledger line.

Transport: the Anthropic Messages API at `ZAI_URL` (`/v1/messages`), with the key
from `ZAI_ANTHROPIC_API_KEY` then `ZAI_API_KEY`, following
`mcp/consultants/shared/zai-env.js`. The model is `[consultants.zai].model`
(`DIAGRAM_REVIEW_GLM_MODEL` overrides). The key goes in an `Authorization` header
only and is never printed, logged or written.

### audit-gemini

Each shard is judged separately. All of these must hold, checked in this order; the first
that fails is that shard's logged reason.

1. At least `gemini_min_interval_days` since the shard's last completed audit (none yet
   means the interval is clear).
2. At least `gemini_min_changed_topics` topics of the shard changed since its last audit
   (per source repository, from the audit line's `commits` map; all of its topics when it
   was never audited), or the shard's last GLM review recorded a high-severity finding
   newer than its last audit (an escalation counts once).
3. Month-to-date Gemini spend across all repos plus the estimate for this shard is within
   `gemini_monthly_usd`. A high-severity finding never overrides the budget.

Shards that pass 1 and 2 are tried **most-changed first**; each one's `countTokens`
estimate is checked against what is left of the cap, so a tight budget is spent where the
corpus has drifted most and a shard that does not fit is logged as a budget refusal.

The estimate comes from a free `countTokens` call: the shard's pack once at the input
rate, once more per extra lens at the cached rate, plus an assumed 30,000 output and
thinking tokens per lens. The run itself is `external-review.cjs --files-from`, given
exactly the shard's topics; the ledger records the cost from the usage it reports. One
`docs/review/<date>-gemini.md` and `.json` cover the run.

Prices (USD per million tokens), constants at the top of `review-cadence.cjs`,
Gemini 3.8 Flash as given on 2026-10-06 and not re-checked against the live
pricing page: input 0.75, cached input 0.075, output including thinking 3.75.
GLM runs under the Z.AI plan and counts as 0, so it never uses the Gemini cap.

A failed `generateContent` is booked at its estimate and counts toward the month,
because a timed-out call may already have been billed. It does not reset the
interval. External review never retries a billable call, and neither does this.

## Ledger

`docs/diagrams/review-ledger.jsonl` in each repo, append-only, one JSON line per
run (per shard for reviews and audits). Fields: `ts`, `kind` (`triage`, `review`, `audit`),
`reviewer` (`glm`, `gemini`), `shard`, `commit`, `commits` (repository to commit),
`unresolved` (skipped source paths), `pack_sha256`, `tokens`, `est_usd`, `findings` (path),
`high_severity`, `changed_topics`, `skipped` (the reason, or null), plus `error`
on a failed call. A torn line is skipped on read. `node $C status` summarises it.
Commit the ledger with the corpus, or ignore it, as the repo prefers: the runner
only appends.

## Operating notes

- With no corpus repo in the workspace the cron finds nothing and spends nothing.
- The cron needs `ZAI_ANTHROPIC_API_KEY` (or `ZAI_API_KEY`) and `GEMINI_API_KEY`
  in the container environment (`.env`). Without the Gemini key an audit is logged
  as skipped; without the Z.AI key triage lists every candidate (unsure means yes)
  and the GLM review fails.
- Logs: `/var/log/diagram-review-cron.log` and `.error.log`.
- Findings are input to build-with-quality like any others; see "After the review"
  in SKILL.md.
