# The repository's own diagram corpus

Some repositories already carry a diagrams-as-code tree: Mermaid or PlantUML sources under
`docs/diagrams/`, usually with an index, often organised by subsystem, sometimes with each
diagram citing the code it was drawn from. Where one exists it is the best scaffold an
explainer can start from, because somebody who knew the system has already decided how it
divides into parts and what each part's hard idea is. Where none exists, nothing changes;
the run proceeds exactly as it would have.

Run `scripts/diagram-corpus.mjs --repo <target>` during orientation, before writing
anything. It looks for `docs/diagrams`, then `docs/diagram`, `docs/architecture/diagrams`,
`docs/design/diagrams` and `diagrams`; `--dir` names another. With no corpus it prints one
line and exits 0, so it is always safe to call. With one it reports the topic files, the
diagram count by kind, the rendered outputs, the declared areas, the index and generator
files, any register markers, and — the part that matters most — which topics cite sources
that have moved since the revision the topic declares.

## What a corpus gives the explainer

**A division of the system.** The corpus's areas and topic ids are an existing anatomy.
Compare them with `scripts/anatomy-coverage.mjs`: an area with no chapter is a gap in the
explainer, and a part of the tree with no topic is a gap in the corpus worth reporting to
its owner. Do not adopt the corpus's ids or filenames in reader text; readers do not know
what CP-04 is.

**Diagrams for gate E.** A corpus diagram that is accurate at today's revision can be
reused, which is cheaper and more faithful than drawing a new one. Reuse means reading the
diagram, confirming its edges against the code, and rendering it where the reader reads,
not copying a rendered image on trust.

**A register of what is not true yet.** A corpus that collects tensions, debt, drift and
open questions has already found the honest limitations, with a citation for each. This is
the best available input to the built / blocked / deferred material, once translated.

**An audience split, sometimes.** A corpus written with a developer half and a business
half has done the register separation this skill asks for. Read the half that matches the
audience, and read the other half only to check a fact.

## Verify before reuse

A corpus is a catalogue at a declared revision, not a live view. Treat every topic as a
claim about the commit it names, and check three things before a chapter leans on it:

1. **The declared revision against HEAD.** The script resolves bare shas, `repo@sha` and
   per-repository maps, and lists each topic whose own cited sources have changed since.
   A stale topic is not wrong; it is unverified, and its ranges must be re-opened.
2. **The citations.** If the corpus ships a generator with a citation check (the script
   reports the tools it finds), run it and record the result with the date and commit, the
   same way the hub asks for the project's own gates.
3. **The claim you are actually making.** A corpus sentence is evidence of what its author
   read, not of what the code does now. The claims ledger cites the source file and line,
   never the corpus topic.

## Shipping the corpus

Mining a corpus for a chapter is one use of it. The other is publishing it whole, because a
corpus of fifty topics and four hundred checked diagrams is the drawn account of the system,
and a reader who has finished a pack often wants exactly that.
`scripts/diagrams-pack.mjs` builds it as a pack of its own, in one invocation:

```
node scripts/diagrams-pack.mjs --repo <target> --out <dir> --title <product> \
     [--dir docs/diagrams] [--generator <path>] [--no-render] [--report <json>] [--no-register]
```

It finds the corpus with the same candidates the detector uses, runs the corpus's own
generator (`tools/diagram-index-gen.cjs`, else `--generator`, else the `diagrams-as-code`
skill's copy) with `--check --cite-check --worktree-citations --render --report`, and writes a
standalone site: a front door, an `areas/<area>/` level, a page per topic, and the register and
the decisions timeline as two further doors, with a persistent rail and prev/next inside each
area. Every path is relative and nothing loads from outside, so the result drops straight into
a sealed pack directory.

**What the pack shows.** The front door states extent and verification together: how many
topics, diagrams and citations; which revisions the corpus declares and what HEAD is; how many
topics cite a source that has moved since; and what the citation checker said. Each topic page
carries its front matter as facts — governing records, ADRs, the files read, the revision and
how it stands against HEAD — then both narratives, then each diagram as drawn, its mermaid one
click below, and a verdict: *n citations resolve at the declared revision*, or the warnings
listed plainly in the checker's own words. A corpus that is partly stale reads as one.

Prefer `--report` where the generator supports it, so the pack publishes the checker's own
findings rather than a second opinion derived here; where the generator predates the flag the
script parses its printed warnings instead, and both paths produce the same pages. The build
refuses to claim success it cannot support: a diagram with no art where rendering was asked
for, a link to a page the pack does not hold, or a placeholder left in the shell each exit 1.
A cross-reference whose anchor no longer matches a heading is reported but does not fail the
build, because that is drift in the corpus and the pack's job is to say so.

**The ringfence narrows here; it does not lift.** The pack is the corpus itself, in the
corpus's own voice, so the reader-text rules below are not what govern it — but the decision
to ship it is. The register is audit material about people and history as much as about code,
and it is the part most likely to hold a sentence nobody meant a client to read, so it ships
only when the corpus's owner has agreed: `--no-register` drops the register page and its door
and builds everything else. And the pack still never lands in the target's tree; it is built to
an output directory outside it, like every other deliverable.

## The ringfence still holds

A corpus is usually internal audit material. Its owner may never have intended it for a
client, and it may name findings, people and history that have no place in a deliverable.
So: mine it; ship it only whole, only as itself, and only with the owner's agreement (above).
Nothing from the corpus enters reader text as its own voice —
no topic ids, no tension or debt numbering, no fix history, no "the corpus says". A
limitation learnt from a register entry is stated in ordinary product terms, grounded in
the same source the register cites, and `scripts/voice-lint.sh` still has to pass.

Do not edit the corpus. It is the target's material, under the hub's rule that nothing
lands in the target except the delivery artefacts. If the corpus is wrong or stale, that is
a finding for its owner, recorded in the production record, not a repair to make in passing.
