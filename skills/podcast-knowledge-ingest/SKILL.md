---
name: podcast-knowledge-ingest
description: >
  Trigger on "/podcast-ingest", "weekly podcast ingest", "process new podcast
  episodes into the ontology", or setting up/debugging the podcast-cron schedule.
  Weekly cron that downloads new episodes from configured YouTube podcasts,
  extracts evidence-backed assertions via the Ontology Loom (Qwen 3.8), verifies
  them with Perplexity, and lands them on podcast-evidence ledger pages. Also
  trigger on "promote podcast evidence", "ledger promotion", or "podcast
  candidate dossiers" — the podcast-promote binary stage that pre-filters
  accumulated ledger evidence into scored proposal dossiers. NOT for one-off
  historical backfill (use podcast-bulk-ingest), interactive on-demand transcript
  fetching (use youtube-transcript-archiver), or non-podcast KG enrichment.
version: 2.0.0
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

Implemented as three Rust binaries in [`services/podcast-ingest`](../../services/podcast-ingest)
(crate `podcast-ingest`, workspace-standalone like `services/dream-engine`):
`podcast-ingest` (this skill's weekly cron, ports `ingest.py`), `podcast-promote`
(the promotion stage below, ports `promote.py`), and `podcast-bulk-ingest`
(the sibling `podcast-bulk-ingest` skill, ports `bulk_ingest.py`). CLI flags
mirror the original Python `argparse` definitions exactly. On-disk JSON/ledger
formats are byte-compatible with the prior Python implementation — see the
crate's ledger round-trip tests.

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

## Page format

Every page this skill writes is a vault page: V2 YAML frontmatter, then the
body (`project/docs/VAULT-corpus-format.md` §V2/§V5, ADR-2028 D4). No writer
emits `key:: value` Logseq property lines. Template shapes for the new-page,
ledger, and working-graph writers:
[references/pipeline-and-operations.md](references/pipeline-and-operations.md).

## Configuration

`podcasts.yaml` in the skill directory or the target output directory:

```yaml
podcasts:
  - channel: "@TheAIDailyBrief"
    name: "AI Daily Brief"
    focus: "AI industry news, policy, models, companies"
    # Paths derive from the vault path authority (ADR-2028). podcast-ingest
    # (ingest::config::expandvars) expands ${VAULT_TRANSCRIPTS} / ${VAULT_PAGES} /
    # ${VAULT_WORKING_PAGES} — the values agentbox.toml's [vault] section
    # resolves to — so relocating the vault relocates this output.
    output_dir: "${VAULT_TRANSCRIPTS}"
    ontology_dir: "${VAULT_PAGES}"

settings:
  loom_url: "${LOOM_BASE_URL}"          # canonical LAN façade (via ml hp-nat DNAT)
  loom_fallback_urls: ["http://the connected node:8084/v1"]  # direct 25G-rail path when the DNAT is down
  loom_model: "qwen3.8-27b"
  max_assertions_per_episode: 15
  min_confidence: 0.4
  quality_threshold: 0.85
  max_episodes_per_run: 15
  backlog_batch_size: 50
```

The Loom URL is resolved once per run by probing `/health` on each candidate in
order; a fallback hit is logged. Both addresses serve the same façade on the connected node.

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

Five phases: delta detection/download, Loom assertion extraction, Perplexity
verification, ontology placement/integration, then marking each file
complete. Full per-phase detail:
[references/pipeline-and-operations.md](references/pipeline-and-operations.md).

## Cron setup

The schedule lives in this skill directory, not in a `pipeline` package — there is
no `--register-cron` flag on `podcast-ingest`. Two registration paths exist:

**Canonical (agentbox): supervisord + supercronic.** The image runs a
`[program:podcast-cron]` supervisor block (`supervisord-podcast-cron.conf`) that
launches `supercronic` against the sibling `crontab` file. That crontab invokes
`run-ingest.sh`, which resolves the `podcast-ingest` binary on PATH and runs
`podcast-ingest --config podcasts.yaml`. No interpreter/capability probe is
needed any more — the binary is self-contained (statically linked, no
site-packages) — so `run-ingest.sh` just needs `podcast-ingest` on PATH. To
deploy, add the block to `/etc/supervisord.conf` at Docker build (see the conf
header for the supercronic `ADD`/`chmod` lines) — no host crond required.
Schedule: Monday 06:17 UTC.

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
podcast-ingest --config podcasts.yaml

# Dry run (extract + verify, don't write to ontology)
podcast-ingest --config podcasts.yaml --dry-run

# Process a specific episode
podcast-ingest --config podcasts.yaml --file the-right-way-to-worry-about-ai.md

# Force reprocess already-processed files
podcast-ingest --config podcasts.yaml --reprocess
```

## Operational lessons

Hard-won facts from the Rust port (generous Loom timeout, `max_tokens`
sizing, treating zero assertions as a clean degrade not a broken pipeline,
supercronic's crontab reload behaviour): carried forward in
[references/pipeline-and-operations.md](references/pipeline-and-operations.md)
so the current code does not regress them.

## Promotion stage (`podcast-promote`)

Downstream of ingest: topics whose ledger accumulates enough evidence
(≥5 assertions across ≥2 episodes by default) become *candidates*; each is
drafted into a splice edit via the Loom, then pre-filtered by two instruments
— a blind before/after quality judge (Gemini, rubric-A prose + rubric-B
informativeness) and a lexical answer-completeness gate. Survivors land as
scored dossiers with assertion-fingerprint provenance, shaped for the
ontology-bridge governed proposal queue; nothing edits curated pages directly.

```bash
# Candidacy scan only (no network, no writes):
podcast-promote --pages-dir <graph pages dir> --proposals-dir promotions/proposals --dry-run

# Canonical full run — rejects land as readable news pages in the working graph:
podcast-promote --pages-dir "$VAULT_PAGES" --proposals-dir promotions/proposals \
  --working-graph-dir "$VAULT_WORKING_PAGES" --limit 15
```

Rejected-from-ontology is not discarded: with `--working-graph-dir`, every
terminal reject also writes `<Topic>.md` into the working graph — the Loom-drafted
prose section plus the attributed evidence bullets, `type: podcast-news` in the
frontmatter, overwritten on each dossier refresh. The curated main graph is
never touched.

Survivors flow onward via `node submit-proposals.mjs` (weekly cron stage 3):
each dossier's payload is submitted as a governed AMEND proposal
(Whelk consistency gate → ACSP human approval → PR) through
`POST /api/ontology-agent/propose`, reusing the ontology-bridge's own request
builder. Addressing is exact-slug-match only (`urn:ngm:class:<slug>`); target
pages with no ontology class are reported and skipped — they need a class
*create* proposal, which stays human-initiated. Idempotent per assertion-
fingerprint set (`promotions/.submitted.json`). Decision surfacing follows
ADR-056's split: this pipeline stages and reports; the signature happens on
the existing governed approval surface, never a second bespoke one.

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
