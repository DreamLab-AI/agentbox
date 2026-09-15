---
name: diagrams-as-code
description: >-
  Build, extend, verify and render a citation-verified Mermaid corpus for a whole
  repository: one topic file per subsystem, every diagram citing the code it was
  drawn from as path:line, every topic stamped with the revision it was verified
  against, and every tension, debt item, doc drift, open question and invariant
  marked in place and collected into a register. Ships the generator that gates it
  — structure, citations at the declared revision, mmdc grammar, 4500px
  legibility, generated indexes and a JSON report. Use whenever someone wants a
  repository or estate mapped, catalogued or cartographed in diagrams, asks for
  "diagrams as code", an architecture diagram set, a diagram corpus or a
  state-of-play audit of a codebase, or wants an existing docs/diagrams tree
  re-verified against HEAD, re-stamped or rendered — even if they only say
  "diagram this repo". Not for one standalone diagram (mermaid-diagrams), a
  published visual (diagram-design), or an audience-facing explainer built ON a
  corpus (explainer).
compatibility: "Claude Code and Codex both read this SKILL.md; the generator is zero-dependency Node >= 18 and harness-agnostic. Authoring a new corpus at scale uses the Agent tool to run an opus area lead with sonnet researchers (references/authoring-mesh.md); a Codex/GPT-6 Astra session runs the same phases sequentially in one session, one area at a time, and leans harder on --cite-check as the gate."
related_skills: [explainer, mermaid-diagrams, diagram-design, docs-alignment, codebase-memory]
---

# Diagrams as code

A diagram corpus is the catalogued state of play of a codebase, machine-checked.
Not a picture set: a tree of topic files under `docs/diagrams/`, each one a
subsystem explained twice (once for whoever inherits the code, once for whoever
owns the product) around Mermaid diagrams whose every claim carries a
`path:line` citation resolvable at a declared commit. The register of what it
found on the way — tensions, debt, drift, open questions, invariants — is
collected automatically and is the real deliverable.

It **catalogues**. It does not propose fixes, extensions or a roadmap. The
register is the input to that later work, never the plan itself.

Two corpora built with this method, for scale: 57 topics / 398 diagrams for one
product repository, 71 topics / 841 diagrams across a ten-repository estate.

## When to use

- **Create** a corpus for a repository or an estate that has none.
- **Extend** one: a new subsystem, a new area, more diagrams on a thin topic.
- **Verify** one against HEAD: which topics' cited sources have moved, which
  citations no longer resolve, what has to be re-read and re-stamped.
- **Render** one: `mmdc` grammar plus the legibility ceiling.
- **Report** on one for another consumer (the `explainer` skill's diagrams pack).

**When NOT to use:** one standalone diagram for a document or a chat answer
(`mermaid-diagrams`); a branded or published visual (`diagram-design`); an
audience-facing explainer, handover or microsite, which *consumes* a corpus but
ships none of its internal wording (`explainer`); auditing prose and cross-links
across a docs corpus (`docs-alignment`); answering "what calls X?" from a
symbol graph (`codebase-memory`).

## The deliverable

```
docs/diagrams/
  README.md              hand-written doors + a generated index block
  COVERAGE.md            generated: by diagram, ADR, governing doc, source path
  REGISTER.md            generated: every marker, with a backlink
  DECISIONS-TIMELINE.md  hand-written: decisions and their reversals in time order
  diagrams.config.json   optional: pins areas/order, coverage roots, ADR dir
  <area>/NN-slug.md      the topic files — the only hand-written diagram content
  rendered/              mmdc output; gitignored, regenerable
  tools/                 a copy of, or a shim onto, the generator
```

## The topic file

One file = one topic = many diagrams = two narratives. Frontmatter:

```yaml
---
id: CP-03                                # <PREFIX>-<NN>, unique tree-wide
title: The SCR executor
area: control-plane                      # = directory name; prefix must match
governing: [docs/explanation/engineering-lane.md]   # repo-relative, must exist
adrs: [ADR-014, ADR-023]                 # records this topic evidences
sources:                                 # repo-relative, must exist
  - control-plane/src/scr/executor.ts
verified_commit: 8cbdb7ae6346e9d7981acac249a47f7341b35bc7
worktree: 2026-09-07                     # only when a source was read dirty
---
```

For a corpus spanning repositories, `verified_commit` is a per-repository map
and a `../`-relative source is attributed to the git toplevel that owns it:

```yaml
verified_commit: {campaignbuilder: c3028b0, co-created: 4f1a9de}
sources: [control-plane/src/scr/executor.ts, ../ACTIONS.md]
```

Body: `## For developers`, `## For the business`, then each diagram under an H2
whose first token is `<id>.<n>`, followed by its labelled paragraphs.

Full contract with an annotated example: [references/topic-contract.md](references/topic-contract.md).
Copy-and-fill: [assets/topic-template.md](assets/topic-template.md).

## Areas and ids

An area is a directory, and every topic in it carries the same two-to-four-letter
id prefix. The generator derives the area→prefix map from the topics themselves,
so a new area is a new directory and needs no code change; a
`diagrams.config.json` with an `areas` map pins the set and, more usefully, the
**reading order** the generated index uses (derivation falls back to
alphabetical). In a multi-repository estate, one area per repository plus a
cross-cutting `estate/` area is the shape that worked.

Aim for six or so areas and a topic per subsystem the reader would name.

## The two narratives

Every topic carries both, and neither is a summary of the other.

- `## For developers` — why the topic exists, what the reader can do afterwards,
  how the pieces relate. Cites records and commits. Any length.
- `## For the business` — the same ground in the product's own vocabulary: what
  it means for a named user, the live site, cost, or risk. No code names unless
  they are the product's names. Any length.

Each diagram then gets **What it shows** (one to three sentences) and **Why it is
this way** (the decision, who took it, when, and the record that owns it).

## Register markers

Written in place, collected into `REGISTER.md`. Use the prefixes exactly — they
are what the register is built from. A marker may carry a scope in parentheses
(`**Tension (ADR-025 vs code):** ...`), which the register shows.

| Marker | Means |
|---|---|
| `**Tension:**` | two records disagree, or a record and the code disagree. One line, both citations. |
| `**Debt:**` | something the code carries that its own authors flagged, or that a reader would. |
| `**Drift:**` | the doc says X, the code does Y. |
| `**Open:**` | a question the record leaves unanswered. |
| `**Invariant:**` | a property the design depends on, with the line that enforces it. |

The same five work inside a diagram as `TENSION:`, `DEBT:`, `DRIFT:`, `OPEN:`,
`INVARIANT:` in a `Note over X:` or a node label. Detail and worked examples:
[references/register-markers.md](references/register-markers.md).

## Verification discipline

A topic is a claim about one commit, and the stamp is what makes it checkable.

1. **Declare the revision** you read the sources at. If the tree was dirty, add
   `worktree: YYYY-MM-DD` and the checker reads working-tree bytes instead.
2. **Derive every line number from the symbol** — `grep -n` the name, read the
   body. Never from an offset or a diff shift. A moved citation that was wrong
   stays wrong.
3. **Run `--cite-check`** and drive the warnings down. A warning is a citation
   the checker could not confirm, not proof of an error — but an unresolvable
   one (a cited file absent from `sources:`) was never checked at all.
4. **Re-stamp when the change set lands**: bump `verified_commit` to the new sha,
   re-resolve that topic's citations at it, and only then drop `worktree:`.

Declared revisions, re-stamping, strict mode, what each warning class means:
[references/verification.md](references/verification.md).

## The render rule

`--render` parses every block through `mmdc` and **fails any render wider than
4500 px** — wider is illegible at any zoom, which is the same as absent.
Re-render after every edit, including a one-line note: the structural checker
cannot see Mermaid grammar. Dark `rect` fills (luminance < 140) and the
low-density kinds (`mindmap`, `pie`, `quadrantChart`, `journey`) are refused
outright.

## Never

- **Invent a fact without a `path:line`.** Every mechanism claim in a diagram
  resolves to a line in a file named in that topic's `sources:`.
- **Edit product code, or the code being catalogued.** This skill reads. A wrong
  thing found is a register marker, not a repair.
- **Ship register wording to a client.** Tensions, debt numbering and drift are
  internal audit material; a deliverable states the limitation in ordinary
  product terms, grounded in the same source. That ringfence belongs to
  `explainer` — see `explainer/references/diagram-corpus.md`.
- **Edit someone else's corpus in passing.** Reuse means verify-then-cite. A
  stale or wrong topic is a finding for its owner.
- **Cite a file you have not opened at the declared revision**, or renumber a
  citation because a diff moved it.

## The generator

`scripts/diagram-index-gen.cjs` — zero dependencies, Node ≥ 18, `mmdc` optional.
Copy it to `<corpus>/tools/` (or a repo `scripts/`) so the corpus is
self-checking without this skill present.

```bash
G=scripts/diagram-index-gen.cjs                     # or docs/diagrams/tools/...
node $G docs/diagrams --check                        # structure only
node $G docs/diagrams --check --cite-check           # + citations (warns)
node $G docs/diagrams --check --render               # + mmdc grammar and width
node $G docs/diagrams --check --cite-check --strict-citations   # CI gate
node $G docs/diagrams --check --cite-check --worktree-citations # dirty tree
node $G docs/diagrams --check --no-source-paths      # CI without sibling repos
node $G docs/diagrams --report out/diagrams.json     # JSON for another consumer
node $G docs/diagrams                                # regenerate the indexes
```

`--only <substr>` restricts any run to matching topic files (and suppresses index
writes). `--jobs N` sets render concurrency, default 6. Exit codes: 0 ok, 1
validation/render error, 2 usage.

`--report` writes one JSON document describing the whole corpus — per topic the
id, file, area, title, `verified_commit`, `worktree`, sources, governing docs,
ADRs, each diagram with its kind and rendered SVG, the citation result and the
register counts, plus corpus totals. It works with or without `--cite-check` and
`--render`; the fields those populate are empty when they did not run. This is
the interface the `explainer` skill's diagrams pack reads.

## Building a corpus

Order, and it matters: **anatomy → areas → topics → register → render**. Decide
what the system is made of before deciding what the files are; write topics
against real line numbers; let the register fall out of the writing rather than
collecting it at the end; render last and often.

At scale this runs as a managed mesh — an area lead writing topics, researchers
resolving every `path:line` before a diagram is committed, and the generator as
the gate between them. Recipe, division of labour and measured throughput:
[references/authoring-mesh.md](references/authoring-mesh.md).

## Mermaid traps

Each of these cost a render cycle on a live corpus.

| Breaks | Where | Do instead |
|---|---|---|
| bare `;`, HTML entities (`&lt;`) | sequence message text, `Note over X:` | commas, `<br/>`, plain prose |
| `::` or a quote | stateDiagram-v2 transition labels | `Foo.bar`, no quotes |
| `{ }` in a member line | classDiagram | drop the braces |
| a `path:line` in a relation label | classDiagram | colon-free prose on the relation; citation in a member line or `note for X "..."` |
| escaped `\"` | flowchart node labels | reword |
| `&&`, `\|`, `>` | sequence messages | prose |
| `call` as a classDef name | flowchart | another name |
| wide `erDiagram`, an `LR` subgraph of unconnected nodes, an unwrapped `note for` | render > 4500 px | `flowchart TB` with subgraphs; wrap notes at ~55 chars with `<br/>` |
| sibling `subgraph` blocks in one rank converging on one node | render > 4500 px | chain them (`A --> B --> C`) so they stack |

Citation traps the checker resolves in ways that surprise:

| Written | Resolves to | Do instead |
|---|---|---|
| bare `:NNN` on a reply `B-->>A: ... (:NNN)` | the file bound to **B**, the sender | qualify the path when the fact is in A's file |
| bare `:NNN` in a flowchart edge label | the last path cited anywhere above it | qualify every edge-label citation |
| a range `file.md:41-82` starting on a blank line | a warning; only the start line is judged | start on the first non-blank line |
| `participant X as executor<br/>executor.ts:NN` | a symbol check against a function named `executor` | label with the real symbol, `execute` |
| a cited file missing from `sources:` | an `unresolvable` warning, never checked | add it to `sources:` |

Ports are written `port 8788`, never `:8788` — a bare colon-number is a citation.

## Depth on demand

- [references/topic-contract.md](references/topic-contract.md) — the full file
  contract, single- and multi-repo, with an annotated example and every rule the
  checker enforces.
- [references/register-markers.md](references/register-markers.md) — what each
  marker means, how to word one, how they are collected.
- [references/verification.md](references/verification.md) — declared revisions,
  re-stamping, `worktree:`, strict mode, warning classes.
- [references/authoring-mesh.md](references/authoring-mesh.md) — producing a
  corpus for a new repository as a managed mesh, with measured throughput.
- [assets/topic-template.md](assets/topic-template.md) — copy and fill.
- `evals/` — three cases and how to run them.
