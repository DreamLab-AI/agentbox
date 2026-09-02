---
name: podcast-bulk-ingest
description: >
  Bulk backfill markdown transcript files for a YouTube podcast series.
  Downloads transcripts, show notes, and links for all episodes in a date range,
  then runs source extraction and applies enrichment tables. Designed for
  one-off historical backfill — for ongoing weekly ingest, see podcast-knowledge-ingest.
  When the podcast covers a domain not yet in the ontology, guides the user
  through OntoCast-based ontology bootstrapping.
version: 2.0.0
triggers:
  - /podcast-bulk-ingest
  - bulk ingest podcast
  - backfill podcast transcripts
  - download podcast series
---

# Podcast Bulk Ingest Skill

One-off backfill of a YouTube podcast series into structured markdown files
with extracted source tables. Produces the raw material that the weekly
`podcast-knowledge-ingest` skill processes into ontology entries.

Implemented as the `podcast-bulk-ingest` Rust binary — one of three binaries
in [`services/podcast-ingest`](../../services/podcast-ingest) (crate
`podcast-ingest`, module `bulk::*`), porting the retired `bulk_ingest.py`.
CLI flags mirror the original `argparse` definition exactly; on-disk file
formats (`.ingest-state.json`, `.enrichment/*.json`, the markdown transcript
shape) are unchanged.

## New domain detection + OntoCast bootstrapping

When ingesting a podcast series that covers a domain not already represented
in the ontology (e.g., biotech, materials science, geopolitics), the skill
detects this and offers to bootstrap ontology pages using OntoCast.

### How it works

1. **Domain probe**: After downloading the first batch of transcripts, the
   skill samples 3–5 episodes and extracts key terms using the Loom. It then
   queries `ontology_search` for each term. If <30% of terms match existing
   pages, the domain is flagged as "new".

2. **User confirmation**: The skill reports findings and asks:
   - "This podcast covers [domain]. Only N% of key terms exist in the ontology.
     Would you like to bootstrap ontology pages for this domain using OntoCast?"
   - Options: Yes (full bootstrap), Partial (top 20 terms only), No (skip)

3. **OntoCast extraction**: If confirmed, the skill:
   - Concatenates the sampled transcripts into a single document
   - Sends it to OntoCast with `RENDER_MODE=ontology_and_facts` and
     the existing ontology as seed (via `ONTOCAST_ONTOLOGY_DIRECTORY`)
   - OntoCast produces Turtle with new classes, relationships, and facts

4. **Staging via ontocast_import.py**: The Turtle output is processed through
   `pipeline.ontocast_import` from the knowledgeGraph repo:
   ```bash
   python -m pipeline.ontocast_import out/ontology.ttl \
     --output-dir review/podcast-bootstrap-[domain] \
     --project-token ngm \
     --domain [domain] \
     --source-document 'podcast:[channel]:bootstrap:[date]' \
     --default-parent-iri urn:ngm:class/[domain-root] \
     --default-parent-label '[Domain Root]'
   ```

5. **Review prompt**: Candidate pages are written to a review directory
   (`public:: false`, `pending-review`). The skill reports:
   - How many candidate classes/individuals were created
   - Which existing pages they link to
   - The user reviews and promotes accepted pages to the main ontology

6. **Resume**: Once the ontology has the new domain's pages, the weekly
   `podcast-knowledge-ingest` cron will enrich them automatically.

### OntoCast prerequisites

OntoCast is an upstream producer — it is NOT vendored into this skill.
To use the bootstrapping flow:

```bash
# Install OntoCast (requires Python 3.12+, an LLM API key)
pip install "ontocast[server,openai]"

# Or use the Loom as the LLM backend (no external API needed):
export LLM_PROVIDER=openai_compatible
export LLM_BASE_URL=http://192.168.2.132:8084/v1
export LLM_API_KEY=not-needed
export LLM_MODEL_NAME=qwen3.8-27b
```

The `ontocast_import.py` adapter lives in the knowledgeGraph repo at
`pipeline/ontocast_import.py`. It accepts any standards-compliant Turtle
and produces private candidate Logseq pages.

### When NOT to use OntoCast

- The podcast covers a domain already well-represented in the ontology
  (AI, crypto, spatial computing, governance) — use the normal enrichment flow
- You want to add a few specific pages manually — just create them
- The podcast is primarily opinion/commentary with few factual claims

## What it does

1. **Download**: Fetches all episodes in a date window from a YouTube channel
   via yt-dlp. One markdown file per episode: title, date, duration, link,
   show notes, extracted links, full auto-generated transcript.

2. **Source extraction**: Regex NLP pass over each transcript to find named
   publications, research firms, company announcements, quotes, and social
   posts. Outputs per-episode JSON to `.enrichment/`.

3. **Enrichment**: Resolves source URLs via Perplexity search. Downloads
   significant reports/papers to `assets/`. Inserts `## Sources Mentioned`
   tables into each markdown file.

4. **Marking**: Sets `ingest-status:: downloaded` on line 1 of each file,
   signalling to the weekly skill that this file exists but has not been
   processed for ontology integration.

## Usage

```bash
podcast-bulk-ingest <channel> [options]
```

### Arguments

| Arg | Default | Description |
|-----|---------|-------------|
| `channel` | required | YouTube channel URL, @handle, or playlist URL |
| `--months` | 6 | Months of history to download |
| `--output-dir` | `./transcripts` | Output directory |
| `--date-start` | computed | Override start date (YYYYMMDD) |
| `--date-end` | computed | Override end date (YYYYMMDD) |
| `--enrich` | flag | Run source extraction + URL resolution |
| `--assets` | flag | Download referenced reports/papers |
| `--max-episodes` | unlimited | Cap number of episodes to download |
| `--old-streak` | 15 | Consecutive old episodes before early exit |

### Examples

```bash
# Backfill 9 months of AI Daily Brief with enrichment
podcast-bulk-ingest @TheAIDailyBrief --months 9 --output-dir "$VAULT_TRANSCRIPTS" --enrich --assets

# Just transcripts for a different podcast, last 3 months
podcast-bulk-ingest @lexfridman --months 3 --output-dir lexfridman

# Specific date window
podcast-bulk-ingest @TheAIDailyBrief --date-start 20251118 --date-end 20260818 --enrich
```

## Output structure

```
output-dir/
├── episode-title-slug.md          # ingest-status:: downloaded on line 1
├── assets/
│   ├── report-name.pdf
│   └── blog-post.html
├── .enrichment/
│   ├── episode-slug.json          # per-episode extracted sources
│   ├── all_sources.json           # flat list for dedup
│   ├── unique_sources.json        # deduplicated source index
│   ├── resolved_urls.json         # Perplexity-resolved URLs
│   └── extraction_summary.json   # stats
└── .ingest-state.json             # video ID → status map
```

## Markdown format

```markdown
ingest-status:: downloaded
# Episode Title

- **Date**: 2026-08-18
- **Duration**: 29:13
- **YouTube**: https://www.youtube.com/watch?v=xxxxx

## Show Notes
...

## Links
...

## Sources Mentioned

| Source | Type | Context | URL |
|--------|------|---------|-----|
...

## Transcript
...
```

## Relationship to other skills

- **podcast-bulk-ingest** (this skill): One-off historical backfill. Produces
  markdown files marked `ingest-status:: downloaded`.
- **podcast-knowledge-ingest** (weekly cron): Processes files marked `downloaded`,
  extracts assertions, integrates into ontology, marks files `processed`.
- **youtube-transcript-archiver**: Interactive agent-triggered variant. Same
  download logic, different orchestration.

## Design decisions

- **`--dump-json` over `--print`**: YouTube descriptions contain newlines that
  corrupt line-based metadata extraction. JSON output is reliable.
- **SRT subtitle cleanup**: Strip timestamps, sequence numbers, HTML tags,
  deduplicate consecutive identical lines.
- **Streak-based early exit**: Flat playlist API returns no date ordering.
  15 consecutive old episodes triggers stop (configurable via `--old-streak`).
- **State file**: `.ingest-state.json` tracks video IDs independently of
  markdown files, enabling fast delta detection on re-runs.
- **Ingest-status marker**: Line 1 of each markdown. Values: `downloaded`
  (bulk ingest done), `pending` (weekly ingest queued), `processed:DATE:N`
  (N assertions extracted on DATE), `skipped` (no extractable assertions).

## Prerequisites

- `podcast-bulk-ingest` (services/podcast-ingest) and `yt-dlp` resolvable on
  PATH — the binary shells out to the `yt-dlp` console script directly (no
  Python interpreter or `PYTHONPATH` involved on this binary's side any more)
- For enrichment: Perplexity MCP tools (`perplexity_search`)
- For asset downloads: `curl` or `wget`
