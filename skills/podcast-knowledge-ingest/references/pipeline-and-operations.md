# Pipeline phases, page format, and operational lessons

Depth reference for `podcast-knowledge-ingest`. Load this when implementing or
debugging the weekly ingest run itself, rather than just invoking it.

## Page format

Every page this skill writes is a vault page: V2 YAML frontmatter, then the
body (`project/docs/VAULT-corpus-format.md` §V2/§V5, ADR-2028 D4). No writer
emits `key:: value` Logseq property lines.

New ontology page (`new_page_content` in `services/podcast-ingest/src/ingest/newpage.rs`,
porting `NEW_PAGE_TEMPLATE` from the retired `ingest.py`):

```markdown
---
public: true
---

# {title}
```json-ld
{ "@type": "Page", ... }
```
```

Assertion-ledger page (`build_ledger_header` in `ingest/ledger.rs`) carries the
episode metadata as frontmatter keys — `public: true` (a real YAML boolean,
never the string `"true"`), `title`, `source`, `episode-url`, `episode-date`,
`ingest-date`. Working-graph reject pages (`write_working_page` in
`promote/working_page.rs`) carry `public: false`, keeping them outside the KG
gate (Invariant 2, fail-closed).

## Pipeline phases

### Phase 1: Delta detection + download

- Load `.ingest-state.json` from output directory
- `yt-dlp --flat-playlist` to get current video list
- Diff against state file — new IDs are this week's episodes
- Download transcript + metadata for each new episode
- Mark files `ingest-status:: downloaded`

### Phase 2: Assertion extraction (Loom)

For each file with `ingest-status:: downloaded`:

- Send transcript to Loom with structured extraction prompt
- Loom returns JSON array of assertions, each with:
  - `claim`: the factual statement
  - `source`: who said/published it
  - `evidence`: data points, quotes, figures
  - `confidence`: Loom's self-assessed confidence (0-1)
- Filter by `min_confidence` threshold
- Mark file `ingest-status:: pending`

### Phase 3: Verification (Perplexity)

For each assertion above threshold:

- `perplexity_search` for the claim + source
- Check: does external evidence corroborate?
- Resolve canonical URL for the source
- Drop assertions that can't be verified
- Attach URL and verification status

### Phase 4: Ontology placement + integration

For each verified assertion:

- `ontology_search` with the claim's key terms
- Score candidates by: relevance to claim, quality score (lower = more room),
  domain match
- Read the target page, check it's the right fit
- Craft an evidence paragraph using Loom (context: existing page content +
  assertion + source URL)
- Edit the markdown: insert under appropriate section
- Update JSON-LD: `outboundWikilinks`, `quality` bump, `relatedTo` edges
- Update provenance with evidence source

### Phase 5: Mark complete

- Update `ingest-status:: processed:DATE:N` on each file
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
  hp-nat DNAT on machinelearn (the `.48`-is-dead / stale-route family of
  failures — see agentbox email-search skill for the fingerprint).
- **Supercronic reads the crontab only at start.** After editing `crontab`,
  `supervisorctl restart podcast-cron`.
- **No interpreter/PATH-capability probe needed post-Rust-port.** The prior
  Python-era lesson here ("no `/usr/bin/python3` in the agentbox image; resolve
  the interpreter by capability") no longer applies — `run-ingest.sh` and
  `run-promote.sh` now just `command -v` the statically-linked binary.
