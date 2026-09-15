# Producing a corpus as a managed mesh

A whole-repository corpus is too large for one agent's context and too
citation-dense to delegate wholesale. What worked on both live instances is a
two-tier mesh with the generator as the contract between the tiers: an **area
lead** on the strong model that decides what the topics are and writes the prose
and the diagrams, and **researchers** on the cheap model that do nothing but
resolve symbols to `path:line` at a named revision. The lead never guesses a line
number; the researcher never writes a narrative.

## Throughput actually measured

| Corpus | Shape | Output | Elapsed |
|---|---|---|---|
| One product repository | 6 areas, single-repo stamps | 57 topics, 398 diagrams, 938 register markers | one working day |
| A ten-repository estate | one area per repo + `estate/` | 71 topics, 841 diagrams | a longer run, spread over several sessions |

Read those as the order of magnitude, not a promise. The variable that dominates
is not diagram count but how much of the code is genuinely unfamiliar: a topic on
a subsystem nobody has read costs several times one on a subsystem the lead
already knows.

## The order

**Anatomy → areas → topics → register → render.** Each phase's output is the next
phase's input, and skipping ahead is where corpora go wrong.

### 1. Anatomy (one agent, no diagrams)

Before any file exists, answer: what is this repository made of, and what would a
reader name the parts? Read the top-level tree, the build and compose files, the
entry points, the record index. Produce a one-page list of candidate areas with a
sentence each, and for each area a list of candidate topics.

Resist the temptation to mirror the directory layout. An area is a thing a reader
would name — "the control plane", "how it is packaged and run", "the client's app
at its boundary" — and it often spans directories.

### 2. Areas (the lead, still no diagrams)

Fix the area set, the id prefixes and the reading order, and write
`diagrams.config.json` (pinning `areas` is what fixes the index order; alphabetical
derivation is the fallback). Write the corpus README's doors — the developer path,
the business path, the register path — before the topics, because the doors force
you to commit to an order and the order exposes a missing area.

Six or so areas. Always include a cross-cutting area (`estate/`) for the topics
that belong to no single subsystem: repository composition, one request end to
end, trust boundaries, deployment topologies, the test and gate system, the
design-record system itself. In a multi-repository corpus, one area per repository
plus that cross-cutting area.

### 3. Topics (the lead, with researchers)

One area lead per area, working topic by topic. For each topic:

1. The lead reads the sources and drafts the topic: frontmatter, both narratives,
   and the diagram list with each diagram's intent in one line.
2. For every fact a diagram will assert, the lead names the symbol and hands it
   to a researcher: *find `verifyContract` in `control-plane/src/scr/verify.ts`
   at sha `8cbdb7a`; give me the line the body starts on and the line that
   enforces the refusal.* The researcher returns `path:line` pairs and nothing
   else — no prose, no interpretation.
3. The lead writes the diagrams with the returned citations, in place.
4. The lead runs `--check --cite-check --only <topic>` and fixes warnings before
   moving on. **The generator is the gate between the tiers**: a topic does not
   leave the lead's hands with warnings in it.
5. `--render --only <topic>` before the topic is considered done, because the
   structural check cannot see grammar.

Parallelism is per area, not per topic: two leads in one area fight over ids and
duplicate diagrams. Ids are allocated up front by the area plan, which removes
the only real coordination problem.

A Codex/GPT-6 Astra session with no subagent tool runs the same phases
sequentially in one session, one area at a time, doing the researcher step inline
with `grep -n`; the generator's citation check carries proportionally more of the
weight, so run it after every topic rather than every area.

### 4. Register (falls out, is not collected)

Markers are written where they are found, during step 3. The register phase is
only a review pass: regenerate `REGISTER.md`, read it end to end as a document,
and fix the three failure modes it exposes — a marker with no citation, an `Open:`
that the code already answers, and the same finding recorded in four topics
(keep the one closest to the enforcing line, cross-reference the rest). Then
write `DECISIONS-TIMELINE.md` by hand from the tensions and drift: the generator
cannot order decisions in time, because chronology is a judgement.

### 5. Render (whole corpus, repeatedly)

Full `--render` over everything. Expect a first pass with real failures — the
4500 px ceiling catches the diagrams that grew while being written, and the fix is
usually splitting one diagram, not shrinking labels. Re-render after every
subsequent edit, however small.

Then the final gate:

```bash
node scripts/diagram-index-gen.cjs docs/diagrams --check --cite-check --render
node scripts/diagram-index-gen.cjs docs/diagrams --report out/diagrams.json
node scripts/diagram-index-gen.cjs docs/diagrams      # write the indexes
```

## Division of labour, stated plainly

| Tier | Model | Does | Never does |
|---|---|---|---|
| Area lead | strong (opus) | decides topics and diagrams, writes both narratives, writes diagrams, marks the register, runs the gate | invents a line number; edits product code |
| Researcher | cheap (sonnet) | resolves symbol → `path:line` at a named revision, reports the enclosing span | writes narrative or diagrams; interprets |
| Generator | none | structure, citations at the declared revision, grammar, width, indexes, report | judges whether a diagram is *right* |

The generator is deliberately not an oracle. It proves that a citation resolves to
a non-blank line in a listed file at a declared revision. Whether the diagram
describes the system is the lead's claim, and the two narratives are how that
claim is made falsifiable by a reader.

## Failure modes seen on both instances

- **Citations by arithmetic.** A lead shifts a block of line numbers to match a
  diff instead of re-reading. The checker cannot catch it when the shifted line is
  non-blank. Re-derive from the symbol, always.
- **Files cited but not listed.** The citation then resolves to nothing and is
  never checked, while the run reports clean. Watch `citationsChecked`.
- **The register collected at the end.** Markers written retrospectively lose
  their citation and become opinions. Write them where they are found.
- **One giant topic per area.** A 40-diagram topic is unreadable and unmergeable.
  Five to eleven diagrams per topic is the working range.
- **Rendering last.** A corpus that has never been rendered has a double-digit
  percentage of blocks that do not parse. Render per topic, during writing.
- **Editing the target's code.** The catalogue's authority comes from being a
  read-only account. A wrong thing found is a marker.
