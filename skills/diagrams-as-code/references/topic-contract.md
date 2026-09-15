# The topic-file contract

One file is one topic: one subsystem or one cross-cutting concern, explained
twice, around as many diagrams as the topic needs (five to eleven, in practice).
Everything here is enforced by `scripts/diagram-index-gen.cjs --check` unless
marked as convention.

## Frontmatter

| Field | Required | Rule |
|---|---|---|
| `id` | yes | `/^[A-Z]{2,4}-\d{2,3}$/`, unique tree-wide, prefix must be the area's |
| `title` | yes | sentence case, no id, no trailing full stop |
| `area` | yes | equals the containing directory name |
| `governing` | yes | list of repo-relative record paths; each must exist (`#anchor` allowed); may be empty (`[]`) |
| `adrs` | yes | list of record ids this topic evidences; may be empty |
| `sources` | yes | list of repo-relative code paths; each must exist; **a citation to a file not in this list is never checked** |
| `verified_commit` | yes | a 7–40 hex sha, or a `{repo: sha}` map |
| `worktree` | no | `YYYY-MM-DD`, set only when a source was read from a dirty tree |

`sources:` is load-bearing twice over: it is the existence check, and it is the
resolution table for every citation in the file. A citation whose file is absent
produces an `unresolvable` warning and is silently unverified — which is worse
than a wrong line, because nothing flags it. Add the file.

### Single repository

```yaml
---
id: CP-03
title: The SCR executor
area: control-plane
governing: [docs/explanation/engineering-lane.md]
adrs: [ADR-014, ADR-023, ADR-026]
sources:
  - control-plane/src/scr/executor.ts
  - control-plane/src/scr/verify.ts
verified_commit: 8cbdb7ae6346e9d7981acac249a47f7341b35bc7
---
```

### Several repositories

A corpus that catalogues an estate cites out of its own repository with `../`
paths, and then one sha cannot stand for all of them. `verified_commit` becomes a
map keyed by repository:

```yaml
---
id: ES-04
title: Deployment topologies over time
area: estate
governing: [docs/explanation/cloud-isolation.md]
adrs: [ADR-018, ADR-019]
sources:
  - enclosure/docker/compose.pod.yaml
  - ../ACTIONS.md
  - ../../VisionFlow/src/main.rs
verified_commit: {campaignbuilder: c3028b0, co-created: 067a914, visionflow: b00c28a}
---
```

The key for a `../` path is **the basename of the git toplevel that owns it**,
lowercased — derived, not configured. A path with no `../` belongs to the corpus's
own repository, whose key is the repo root's basename (or `defaultRepoKey`).
A repository present in `sources:` but missing from the map has its citations
resolved against the working tree instead, silently: check the map covers every
repository you cite.

## Body

```markdown
## For developers
Why this topic exists, what the reader should be able to do afterwards, how the
pieces relate. Any length. Cites records and commits.

## For the business
The same ground in the product's own vocabulary: what it means for a named user,
the live site, cost or risk. Any length. No code names unless they are the
product's own names.

## CP-03.1 The executor's state machine
```mermaid
stateDiagram-v2
    ...
```
**What it shows.** One to three sentences.
**Why it is this way.** The decision, who took it, when, and the record that owns it.
**Tension (ADR-025 vs code):** two records disagree. One line, both citations.
**Invariant:** a property the design depends on, with the line that enforces it.
```

Both narrative H2s are required, matched case-insensitively on the exact words
`For developers` and `For the business`. A topic with no mermaid block is an
error. Every mermaid block must sit under an H2 whose **first token** is
`<id>.<n>`; that token is the diagram id and must be unique tree-wide. Diagram
numbering is per-topic and sequential — renumber when you insert.

## What the checker refuses

- frontmatter missing, unterminated, or missing a required field
- `area` not a known area, or not matching the directory
- an `id` malformed, duplicated, or carrying the wrong area prefix
- a `verified_commit` that is neither a sha nor a `{repo: sha}` map
- a `worktree` that is not `YYYY-MM-DD`
- a `sources:` or `governing:` path that does not exist (unless `--no-source-paths`)
- a mermaid block with no H2, or under an H2 whose id is not `<id>.<n>`
- a duplicate diagram id anywhere in the tree
- a missing narrative section
- a low-density diagram kind: `mindmap`, `pie`, `quadrantChart`, `journey`
- a dark `rect` fill (luminance < 140) — the message text stops being readable
- an unterminated code fence
- with `--render`: any mmdc parse error, or any render wider than 4500 px

## Conventions the checker cannot see

- **Filenames** are `NN-kebab-slug.md`, `NN` matching the id's number.
- **Diagram kinds** carry meaning: `sequenceDiagram` for a request's life,
  `stateDiagram-v2` for a lifecycle, `flowchart TB` for composition and
  decisions, `classDiagram` for a contract's shape, `erDiagram` sparingly and
  never wide, `gantt` only for real chronology.
- **Bind every sequence participant to a file** (`participant EX as execute<br/>executor.ts:41`)
  so bare `:NNN` references in that diagram resolve to the right file.
- **One idea per diagram.** A diagram that needs three paragraphs of prose to
  read is two diagrams.
- **Ports are prose**: `port 8788`, never `:8788` — a bare colon-number is read
  as a citation.
- **The register is written where it is found**, not collected at the end.
