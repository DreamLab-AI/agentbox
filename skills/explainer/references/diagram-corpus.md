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

## The ringfence still holds

A corpus is usually internal audit material. Its owner may never have intended it for a
client, and it may name findings, people and history that have no place in a deliverable.
So: mine it, do not ship it. Nothing from the corpus enters reader text as its own voice —
no topic ids, no tension or debt numbering, no fix history, no "the corpus says". A
limitation learnt from a register entry is stated in ordinary product terms, grounded in
the same source the register cites, and `scripts/voice-lint.sh` still has to pass.

Do not edit the corpus. It is the target's material, under the hub's rule that nothing
lands in the target except the delivery artefacts. If the corpus is wrong or stale, that is
a finding for its owner, recorded in the production record, not a repair to make in passing.
