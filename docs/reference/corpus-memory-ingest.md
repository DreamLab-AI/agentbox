# Corpus memory ingest (`knowledge/pages`)

`scripts/corpus-memory-ingest.mjs` re-ingests the visionGraph corpus into RuVector namespace `knowledge/pages` in place. It shares its embedding and upsert helpers with `scripts/ruvnet-brain-ingest.mjs` (`scripts/lib/ruvector-bulk.mjs`). Authorisation and the erasure position are recorded in the 2026-10-31 amendment to [ADR-2014](../adr/ADR-2014-memory-mcp-only-fail-closed.md).

## Usage

```
node scripts/corpus-memory-ingest.mjs                         # dry-run: print the plan, write nothing
RUVECTOR_ADMIN_WRITE=true node scripts/corpus-memory-ingest.mjs --yes [--prune] [--include-working]
```

- Dry-run is the default and opens a read-only database session. `--yes` is refused unless `RUVECTOR_ADMIN_WRITE=true`.
- `knowledge/` is always ingested; the private `working/` vault only with `--include-working`. A page present in both is ingested from `knowledge/`.
- `--prune` deletes `knowledge`-sourced rows the corpus no longer generates (vanished pages, stale sections). The keys are written to a JSONL receipt first. Rows whose page exists only in an excluded vault are kept.
- Idempotent: a row whose content hash matches, that has a vector and carries the current `embed_model` stamp, is not re-embedded. A run at the generation recorded in `_manifest` with no failures is a no-op.
- Every row's metadata gains `generation` (visionGraph HEAD sha, `+dirty` when the vault has local changes), `corpus_version`, `content_hash`, `meta_hash`, `embed_model` and `vault`.
- Next step after a write run: rebuild the HNSW index, `scripts/ruvector-sidecar-update.sh reindex --yes` (ADR-2133).

## Key scheme

Reverse-engineered from the 20,119 rows written between 2026-03-16 and 2026-04-11 (the original writer is not in this repository). Implemented in `scripts/lib/corpus-chunker.mjs`; do not change a rule without a plan for the stale rows it would leave.

| Part | Rule |
|---|---|
| id / key | id `knowledge/pages/<key>`, `source_type` `knowledge`, key `<page-slug>::<section-slug>[::p<N>]` |
| page slug | file stem, lower-cased; characters outside `[a-z0-9]`, whitespace, `-`, `/`, `:` dropped; `___` read as `/`; `_` dropped; each whitespace char becomes `-` (no collapsing or trimming) |
| section | text before the first `##`/`###` heading is `section-0`; every `##`/`###` at column 0 outside a fenced block starts a section; `#` and `####`+ do not split. Section slug = same slug function of the heading text |
| chunk_index | position in the section list, counting an empty `section-0` |
| split | a section over 2048 chars (trimmed) becomes `::p0..pN`: paragraphs (blank-line separated) are packed while the part stays within 2048; each later part is prefixed with the last 128 chars of the previous one; a single paragraph is never cut |
| value | `{ title: "<page> > <section>[ (part N)]", content, content_hash }`, `content_hash` = md5 of content, 12 hex chars |
| collisions | two headings with the same slug in one page share a key; the later wins (as the original upsert did). The plan counts them |

Reproduction against the live rows is in `tests/corpus-memory-ingest.spec.mjs` (fixture `tests/fixtures/corpus-memory-live-rows.json`: 44 unsplit sections and 10 split sections sampled from the namespace).

## Why most rows are rewritten

The vault was converted from Logseq outlines to Obsidian Markdown (ADR-OM-007), so most page text no longer matches the stored rows. Of 10,868 non-split rows on pages that still exist, 741 are still verbatim in today's file. Where text is unchanged the scheme reproduces (124 of 126 rows); where it changed, the keys change with it, so an in-place upsert leaves the old keys as stale rows. That is what `--prune` is for.
