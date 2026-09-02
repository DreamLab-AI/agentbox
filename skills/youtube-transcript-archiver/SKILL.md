---
name: youtube-transcript-archiver
description: >
  Batch-download YouTube channel transcripts, show notes, and links as markdown files.
  Enriches each file with source extraction from transcripts, cross-checked via Haiku,
  and optionally downloads referenced reports/papers to a local assets directory.
  Designed for podcast and video series archival.
version: 1.0.0
triggers:
  - /youtube-archive
  - youtube transcript
  - podcast transcript
  - download transcripts
  - archive youtube
  - youtube series
---

# YouTube Transcript Archiver Skill

Batch-download and enrich transcripts from any YouTube channel or playlist into
a structured markdown archive with extracted sources and downloadable assets.

## What it does

1. **Download phase**: Fetches all episodes in a date range from a YouTube
   channel using yt-dlp. Produces one markdown file per episode containing
   title, date, duration, YouTube link, show notes, extracted links, and the
   full auto-generated transcript.

2. **Enrichment phase**: Scans each transcript for mentioned sources (reports,
   articles, papers, company announcements) using NLP pattern extraction.
   Cross-checks each extraction with Haiku for accuracy. Resolves URLs via
   Perplexity search where possible.

3. **Asset phase**: Downloads referenced reports/papers (PDFs, blog posts) to
   a local `assets/` subdirectory and links them from each markdown file.

## Usage

```
/youtube-archive <channel-url-or-handle> [--months N] [--output-dir path] [--enrich] [--assets]
```

### Arguments

| Arg | Default | Description |
|-----|---------|-------------|
| `channel` | required | YouTube channel URL, handle (@Name), or playlist URL |
| `--months` | 6 | How many months back to archive |
| `--output-dir` | `./transcripts` | Where to write markdown files |
| `--enrich` | false | Run source extraction + cross-check pass |
| `--assets` | false | Download referenced reports/papers |
| `--resume` | true | Skip already-downloaded episodes |

### Examples

```bash
# Archive last 6 months of AI Daily Brief
/youtube-archive @AIDailyBrief --months 6 --enrich --assets

# Archive a specific playlist
/youtube-archive https://www.youtube.com/playlist?list=PLxxx --months 12

# Just transcripts, no enrichment
/youtube-archive @lexfridman --months 3 --output-dir lexfridman-transcripts
```

## Prerequisites

- `yt-dlp` (installed via pip to `~/.local/lib/python3.12/site-packages`)
- For enrichment: Haiku model access (via claude API or agent spawning)
- For asset downloads: Perplexity MCP tools (`perplexity_search`)
- For URL summarisation: `WebFetch` tool

## Output structure

```
output-dir/
├── episode-title-slug.md          # One per episode
├── assets/
│   ├── mckinsey-ai-adoption-2026.pdf
│   └── openai-system-card-gpt5.pdf
├── source-index.md                # Cross-episode source index
└── .subs_tmp/                     # Temporary subtitle files (cleaned up)
```

## Markdown file format

```markdown
# Episode Title

- **Date**: 2026-08-18
- **Duration**: 29:13
- **YouTube**: https://www.youtube.com/watch?v=xxxxx

## Show Notes

(YouTube description)

## Links

- https://example.com/report.pdf → [local](assets/report.pdf)
- https://example.com/article

## Sources Mentioned

| Source | Type | Context | URL |
|--------|------|---------|-----|
| Bloomberg | article | "Bloomberg reports that..." | https://... |
| McKinsey AI report | report | "according to McKinsey's latest..." | [local](assets/...) |

## Transcript

(full transcript text, paragraphed every ~500 words)
```

## Swarm deployment

For large archives (100+ episodes), deploy as a swarm:

```
Phase 1 (download):     1 agent, sequential (rate-limit friendly)
Phase 2 (enrichment):   N agents in parallel (one per batch of 10 episodes)
Phase 3 (asset fetch):  N agents in parallel (one per unique source)
```

The download phase is deliberately sequential to avoid YouTube rate limiting.
Enrichment and asset phases parallelise well.

## Implementation

The core download logic is in the `yt-transcript-archive` binary. It can be run
standalone or invoked by agents.

### Key design decisions

- **`--dump-json` over `--print`**: YouTube descriptions contain newlines that
  corrupt line-based metadata parsing. JSON output is reliable.
- **SRT over VTT**: Auto-generated VTT has overlapping cue timestamps that
  produce duplicate text. SRT conversion via yt-dlp deduplicates.
- **Date-window filtering**: The flat playlist API doesn't support date
  filtering, so we fetch all IDs (fast, metadata-only) then check each video's
  upload date individually. A streak of 15+ old episodes triggers early exit.
- **Slug-based filenames**: Episode titles are slugified to max 80 chars for
  filesystem safety. Video IDs are embedded in the markdown for deduplication.
