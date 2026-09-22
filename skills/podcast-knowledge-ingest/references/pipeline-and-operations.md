# Pipeline phases, page format, and operational lessons

Depth reference for `podcast-knowledge-ingest`. Load this when implementing or
debugging the weekly ingest run itself, rather than just invoking it.

## Page format

Every page this skill writes is a vault page: V2 YAML frontmatter, then the
body (`project/docs/VAULT-corpus-format.md` §V2/§V5, ADR-2028 D4). No writer
emits `key:: value` property lines, and `vault validate` fails on any that
survive.

New working page (`new_page_content` in `services/podcast-ingest/src/ingest/newpage.rs`,
porting `NEW_PAGE_TEMPLATE` from the retired `ingest.py`) is frontmatter plus a
heading. The json-ld fence the v1 template carried is GONE — a fence is a
rejected construct (contract C1 `validation.rejected_constructs`), and the
JSON-LD context is a build output, not page content (PRD Q4).

Assertion-ledger page (`build_ledger_header` in `ingest/ledger.rs`;
`write_assertion_ledger` in `visionGraph/transcripts/weekly_ingest.py`) is a
`type: Episode` page at:

```
working/pages/podcast-evidence/<episode-slug>.md
```

PRD Q16. A subdirectory, never the retired flat `podcast-evidence___<slug>.md`
name (`a___b.md` is a rejected construct), and never `knowledge/pages`. It
carries the episode metadata as frontmatter keys — `public: false` (a real YAML
boolean; ALWAYS false, owner 2026-09-22 14:00 — Q16 publishes `public: true`
from EITHER vault, so the writer must never emit it. Publishing an Episode is a
human act; a re-ledgered page is reset to false), `title`, `source`,
`episode-url`, `episode-date`, `ingest-date`, `tier` (the best, i.e. lowest,
tier on the page) and `confidence` (the highest on the page).

Per-assertion detail is rendered in the body as `**tier:** N`,
`**confidence:** F`, `**source:** S`, `**claim-date:** D`, `**evidence:** E`
prose (contract C1 migration rule C) with the fingerprint in an HTML comment.
It is carried machine-readably in the `assertions:` frontmatter list, which is
what a parser should read: `working/` tolerates unknown keys (OKF §4.1), so the
list is a documented extension. Indented `key:: value` sub-lines are GONE —
they were a rejected construct wearing a bullet.

Working-graph reject pages (`write_working_page` in `promote/working_page.rs`)
carry `public: false`, keeping them outside the KG gate (Invariant 7,
fail-closed), and `type: Note` — the pre-v2 `type: podcast-news` is not a
`working_types` value.

> **Open follow-up, out of Part B scope (owner: `services/podcast-ingest`).**
> `podcast-promote --pages-dir` still assumes ledger pages and target topic
> pages sit in ONE directory. They no longer do: ledgers are in
> `$VAULT_WORKING_PAGES/podcast-evidence/`, topic pages in `$VAULT_PAGES`.
> `podcast-promote` needs a separate `--ledger-dir`, and `run-promote.sh` a
> matching argument, before the promotion stage reads the new layout. Its
> ledger parser must also read the `assertions:` frontmatter list instead of
> the retired indented `key::` sub-lines.

## Working-graph pages are OKF-typed (ADR-2107, PRD Q9)

The working vault (`$VAULT_WORKING_PAGES`, `visionGraph/working/pages`) is not a
scratch directory. It is OKF-conformant with its own type set, and every page
this pipeline writes there carries:

```yaml
---
type: Episode | Transcript | Draft Concept   # working_types, contract C1
title: <page title>
public: false                                # everything this pipeline writes, ledger Episodes included
status: draft                                # a Draft Concept is what a proposal is generated from
generated: { by: process:podcast-ingest/2.0.0, at: 2026-09-22T06:17:00Z }
sources: [{ id: origin, resource: "https://www.youtube.com/watch?v=…" }]
---
```

`generated.by` is an **actor**, in the `process:<name>/<version>` form contract
C1 fixes. It is not decoration: it is how a reader tells a machine-written page
from an authored one, and how a later demotion knows what produced the claim.
`working/` tolerates unknown keys (OKF §4.1), so episodic extras — `episode-url`,
`episode-date`, `ingest-date`, `ingest-status` — are documented extensions
alongside these, not replacements for them.

### Promotion is `vault propose`. Full stop.

A working page reaches `knowledge/` **only** through
`vault propose <iri> --level content|schema`, which runs Whelk and the conflict
detector as blockers and posts a forum 31402 for a human signature.

Do not hand-write an `elevatedFrom` key, copy a page across, or edit a
`knowledge/` page to fold in working content. That path used to exist and it is
what let unsigned machine output accumulate in the curated corpus indistinguishably
from authored work. `sources: [{ id: origin, resource: "[[working/…]]" }]` on the
knowledge page records the lineage, and the approval writes it — not you.

`vault edit` exists but refuses without `--expect docs=N,blocks=M`. It is how an
approved decision is applied, not a way to apply one.

## Pipeline phases

### Phase 1: Delta detection + download

- Load `.ingest-state.json` from output directory
- `yt-dlp --flat-playlist` to get current video list
- Diff against state file — new IDs are this week's episodes
- Download transcript + metadata for each new episode
- Mark files `ingest-status: downloaded` (a frontmatter key, not a `key::` line)

### Phase 2: Assertion extraction (Loom)

For each file with `ingest-status: downloaded`:

- Send transcript to Loom with structured extraction prompt
- Loom returns JSON array of assertions, each with:
  - `claim`: the factual statement
  - `source`: who said/published it
  - `evidence`: data points, quotes, figures
  - `confidence`: Loom's self-assessed confidence (0-1)
- Filter by `min_confidence` threshold
- Mark file `ingest-status: pending`

### Phase 3: Verification (Perplexity)

For each assertion above threshold:

- `perplexity_search` for the claim + source
- Check: does external evidence corroborate?
- Resolve canonical URL for the source
- Drop assertions that can't be verified
- Attach URL and verification status

### Phase 4: Working-graph placement

For each verified assertion:

- `vault find --query "<key terms>" --type Class --json` (ADR-2107; the
  `ontology_search` MCP tool is retired)
- Score candidates by relevance to the claim and domain match. **Not by quality
  score.** The retired Python scored "lower quality = more room" and so aimed
  every machine-written claim at the pages least able to absorb one safely.
- Craft an evidence paragraph using the Loom (context: existing page content +
  assertion + source URL)
- Write it to the WORKING vault as an OKF-typed `Draft Concept` page. Curated
  `knowledge/` pages are never edited here — promotion is `vault propose`,
  which blocks on Whelk inconsistency and needs a human 31403 signature.
- Record the assertion on the episode's evidence ledger page under
  `working/pages/podcast-evidence/` — including assertions that name no
  ontology term, which reach no Draft Concept page and would otherwise be
  lost
- Derived data (`outboundWikilinks`, backlinks, link resolution, the OKF
  index) is a BUILD output and is never written into a page (Invariant 8)

### Phase 5: Mark complete

- Update `ingest-status: processed:DATE:N` on each file
- Update `.ingest-state.json` with processing status
- Log summary to stdout (for cron capture)

## Operational lessons (carried forward from the 2026-08-21 Python eval)

Hard-won facts baked into the current code — do not regress them:

- **Loom timeout must be generous.** Qwen3.8-27B reasoning over a full episode
  transcript regularly exceeds 3 minutes; `ingest::loom::call_loom` uses a
  600s `reqwest` timeout. A 180s timeout produced spurious read-timeout
  failures.
- **Reasoning tokens count against `max_tokens`.** At 4096 the model's
  `reasoning_content` starved the answer and truncated the JSON array
  mid-object (`finish_reason=length`). Extraction uses `max_tokens=12288`,
  and `ingest::extract::salvage_top_level_objects` recovers complete
  top-level assertions from a truncated array as a backstop.
- **Zero assertions ≠ broken pipeline.** Loom connection errors degrade
  gracefully to "No assertions met threshold" per file. If a whole run yields
  nothing, check Loom reachability first (`curl <loom>/health`), then the
  hp-nat DNAT on the gateway host (the `.48`-is-dead / stale-route family of
  failures — see agentbox email-search skill for the fingerprint).
- **Supercronic reads the crontab only at start.** After editing `crontab`,
  `supervisorctl restart podcast-cron`.
- **No interpreter/PATH-capability probe needed post-Rust-port.** The prior
  Python-era lesson here ("no `/usr/bin/python3` in the agentbox image; resolve
  the interpreter by capability") no longer applies — `run-ingest.sh` and
  `run-promote.sh` now just `command -v` the statically-linked binary.
