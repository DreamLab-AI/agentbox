---
name: podcast-knowledge-ingest
description: >
  Weekly cron job that downloads new podcast episodes, extracts evidence-backed
  assertions using the Ontology Loom (Qwen 3.8), verifies them via Perplexity,
  navigates the ontology to find placement, and integrates knowledge into existing
  pages. Runs against a configured set of YouTube podcasts.
version: 1.0.0
triggers:
  - /podcast-ingest
  - weekly podcast ingest
  - podcast knowledge extraction
cron:
  schedule: "0 6 * * 1"
  description: "Every Monday at 06:00 UTC — catches weekend + weekday episodes"
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
  loom_url: "http://192.168.2.132:8084/v1"
  loom_model: "qwen3.8-27b"
  max_assertions_per_episode: 5
  min_confidence: 0.6
  quality_threshold: 0.85
  max_episodes_per_run: 15
```

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

```bash
# Register with the container's cron system
python -m pipeline.podcast_knowledge_ingest --register-cron

# Or manually via CronCreate MCP tool:
# Schedule: 0 6 * * 1 (Monday 06:00 UTC)
# Command: cd /home/devuser/workspace/logseq/ai-daily-brief-transcripts && python /home/devuser/workspace/project/agentbox/skills/podcast-knowledge-ingest/ingest.py --config podcasts.yaml
```

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
