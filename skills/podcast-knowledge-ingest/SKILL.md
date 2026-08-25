---
name: podcast-knowledge-ingest
description: >
  Trigger on "/podcast-ingest", "weekly podcast ingest", "process new podcast
  episodes into the ontology", or setting up/debugging the podcast-cron schedule.
  Weekly cron that downloads new episodes from configured YouTube podcasts,
  extracts evidence-backed assertions via the Ontology Loom (Qwen 3.8), verifies
  them with Perplexity, and lands them on podcast-evidence ledger pages. Also
  trigger on "promote podcast evidence", "ledger promotion", or "podcast
  candidate dossiers" — the promote.py stage that pre-filters accumulated
  ledger evidence into scored proposal dossiers. NOT for one-off historical
  backfill (use podcast-bulk-ingest), interactive on-demand transcript
  fetching (use youtube-transcript-archiver), or non-podcast KG enrichment.
version: 1.2.0
triggers:
  - /podcast-ingest
  - weekly podcast ingest
  - podcast knowledge extraction
  - ledger promotion
cron:
  schedule: "17 6 * * 1"
  description: "Every Monday at 06:17 UTC — off-minute to avoid a thundering herd; catches weekend + weekday episodes"
---

# Podcast Knowledge Ingest Skill

Automated weekly extraction of evidence-backed knowledge from podcast transcripts
into the ontology. Downloads new episodes, extracts assertions, verifies them,
and integrates into existing ontology pages.

## Architecture

```
YouTube ──yt-dlp──► Markdown ──Loom──► Assertions ──Perplexity──► Verified
                        │                                             │
                        ▼                                             ▼
                  ingest-status::              ontology-bridge ◄──────┘
                   downloaded                      │
                        │                          ▼
                        └──────► ingest-status:: processed:DATE:N
```

### Tools used

| Tool | Role | Cost |
|------|------|------|
| yt-dlp | Download new episodes | Free (local) |
| Ontology Loom (Qwen 3.8 at :8084) | Extract assertions from transcripts | Free (local LAN) |
| Perplexity MCP | Verify assertions + resolve URLs | Per-query |
| ontology-bridge MCP | Navigate graph, find placement | Free (local) |
| Direct file edit | Integrate knowledge into ontology pages | Free |

## Configuration

`podcasts.yaml` in the skill directory or the target output directory:

```yaml
podcasts:
  - channel: "@TheAIDailyBrief"
    name: "AI Daily Brief"
    focus: "AI industry news, policy, models, companies"
    output_dir: "/home/devuser/workspace/logseq/ai-daily-brief-transcripts"
    ontology_dir: "/home/devuser/workspace/logseq/mainKnowledgeGraph/pages"

settings:
  loom_url: "http://192.168.2.132:8084/v1"          # canonical LAN façade (via ml hp-nat DNAT)
  loom_fallback_urls: ["http://10.10.10.1:8084/v1"]  # direct 25G-rail path when the DNAT is down
  loom_model: "qwen3.8-27b"
  max_assertions_per_episode: 15
  min_confidence: 0.4
  quality_threshold: 0.85
  max_episodes_per_run: 15
  backlog_batch_size: 50
```

The Loom URL is resolved once per run by probing `/health` on each candidate in
order; a fallback hit is logged. Both addresses serve the same façade on HP.

## Ingest-status lifecycle

Line 1 of each markdown file:

| Value | Meaning |
|-------|---------|
| `ingest-status:: downloaded` | Transcript exists, not yet processed |
| `ingest-status:: pending` | Queued for this run |
| `ingest-status:: processed:DATE:N` | N assertions extracted on DATE |
| `ingest-status:: skipped` | No extractable assertions |
| `ingest-status:: error:DATE:reason` | Processing failed |

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

## Cron setup

The schedule lives in this skill directory, not in a `pipeline` package — there is
no `--register-cron` flag on `ingest.py`. Two registration paths exist:

**Canonical (agentbox): supervisord + supercronic.** The image runs a
`[program:podcast-cron]` supervisor block (`supervisord-podcast-cron.conf`) that
launches `supercronic` against the sibling `crontab` file. That crontab invokes
`run-ingest.sh`, which resolves a Nix `python3` capable of importing the deps and
runs `ingest.py --config podcasts.yaml`. To deploy, add the block to
`/etc/supervisord.conf` at Docker build (see the conf header for the supercronic
`ADD`/`chmod` lines) — no host crond required. Schedule: Monday 06:17 UTC.

**Legacy (classic crond host only): `cron-setup.sh`.** Installs the same weekly
line into the user crontab. Do NOT run it inside agentbox — supervisord already
owns the schedule and you would end up running twice.

```bash
# Classic-crond host only (never inside agentbox):
./cron-setup.sh
```

Files: `supervisord-podcast-cron.conf`, `crontab`, `run-ingest.sh`, `cron-setup.sh`
— all in this skill directory.

## Manual run

```bash
# Process all unprocessed episodes
python ingest.py --config podcasts.yaml

# Dry run (extract + verify, don't write to ontology)
python ingest.py --config podcasts.yaml --dry-run

# Process a specific episode
python ingest.py --config podcasts.yaml --file the-right-way-to-worry-about-ai.md

# Force reprocess already-processed files
python ingest.py --config podcasts.yaml --reprocess
```

## Operational lessons (2026-08-21 eval)

Hard-won facts baked into the current code — do not regress them:

- **No `/usr/bin/python3` in the agentbox image.** The image is Nix-composed;
  the first `python3` on a bare PATH lacks pyyaml. `run-ingest.sh` resolves the
  interpreter *by capability* (`import yaml, requests`), and the flake's
  `[program:podcast-cron]` puts `${pythonRuntimeEnv}/bin` first on PATH.
  Never hardcode an interpreter path or a `~/.local` PYTHONPATH.
- **Loom timeout must be generous.** Qwen3.8-27B reasoning over a full episode
  transcript regularly exceeds 3 minutes; `call_loom` uses `timeout=600`.
  A 180s timeout produced spurious "Read timed out" failures.
- **Reasoning tokens count against `max_tokens`.** At 4096 the model's
  `reasoning_content` starved the answer and truncated the JSON array
  mid-object (`finish_reason=length`). Extraction uses `max_tokens=12288`,
  and the parser salvages complete top-level objects from a truncated array
  as a backstop.
- **Zero assertions ≠ broken pipeline.** Loom connection errors degrade
  gracefully to "No assertions met threshold" per file. If a whole run yields
  nothing, check Loom reachability first (`curl <loom>/health`), then the
  hp-nat DNAT on machinelearn (the `.48`-is-dead / stale-route family of
  failures — see agentbox email-search skill for the fingerprint).
- **Supercronic reads the crontab only at start.** After editing `crontab`,
  `supervisorctl restart podcast-cron`.

## Promotion stage (`promote.py`)

Downstream of ingest: topics whose ledger accumulates enough evidence
(≥5 assertions across ≥2 episodes by default) become *candidates*; each is
drafted into a splice edit via the Loom, then pre-filtered by two instruments
— a blind before/after quality judge (Gemini, rubric-A prose + rubric-B
informativeness) and a lexical answer-completeness gate. Survivors land as
scored dossiers with assertion-fingerprint provenance, shaped for the
ontology-bridge governed proposal queue; nothing edits curated pages directly.

```bash
# Candidacy scan only (no network, no writes):
python3 promote.py --pages-dir <graph pages dir> --proposals-dir promotions/proposals --dry-run

# Canonical full run — rejects land as readable news pages in the working graph:
python3 promote.py --pages-dir <graph pages dir> --proposals-dir promotions/proposals \
  --working-graph-dir ~/workspace/logseq/workingGraph/pages --limit 15
```

Rejected-from-ontology is not discarded: with `--working-graph-dir`, every
terminal reject also writes `<Topic>.md` into the working graph — the Loom-drafted
prose section plus the attributed evidence bullets, `type:: podcast-news`,
overwritten on each dossier refresh. The curated main graph is never touched.

Idempotent per assertion-fingerprint set; instrument outages defer (retry next
run) rather than reject. Full contract, thresholds, dossier JSON shape, and the
live E2E test record: [references/promotion.md](references/promotion.md).

## Relationship to other skills

- **podcast-bulk-ingest**: One-off historical backfill → produces `downloaded` files
- **podcast-knowledge-ingest** (this skill): Weekly cron → processes `downloaded`
  files into ontology entries, marks `processed`
- **youtube-transcript-archiver**: Interactive agent-triggered variant

## Assertion quality gate

Not everything said on a podcast belongs in the ontology. The Loom prompt
filters for:

- Claims backed by a named study, report, or official disclosure
- Quantitative data points (percentages, dollar figures, timelines)
- Direct quotes from named individuals with institutional affiliation
- Events with specific dates and named participants

Excluded: speculation, opinion, hedged predictions, "some people say",
commentary without sourcing.

## Deduplication

The state file tracks assertion fingerprints (`sha256(source + claim_normalised)`).
If the same fact appears in multiple episodes, only the first occurrence is
integrated. Later episodes that add new detail to an existing claim trigger an
update rather than a duplicate insert.
