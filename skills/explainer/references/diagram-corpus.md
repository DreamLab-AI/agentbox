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

## Refreshing a pack from the corpus

The common job after the first one is not a new pack but an old pack whose system has moved:
the code changed, the corpus was rewritten to match, and the chapters still describe last
month. A corpus at HEAD has already done the hard part of that job. Every span it cites has
been resolved and machine-checked at its declared commit, so a drafting session that is sent
back to `grep -n` for line numbers is being asked to repeat finished work, more slowly and
less reliably. A local model under pressure guesses the number instead.

`scripts/corpus-sheet.mjs` hands the work over instead:

```
node scripts/corpus-sheet.mjs --repo <target> --list                       # planning: id, area, title, sections, revision
node scripts/corpus-sheet.mjs --repo <target> --topics CP-01,BL-03 \
     --half business --out <record>/sheets/<chapter>.md                  # one chapter's fact sheet
```

The sheet gives, per topic, the narrative half that matches the audience (`business` for user
and executive packs, `developer` for the developer pack), then each diagram section with its
rendered file, its "What it shows" paragraph and every citation rewritten as a chapter link,
`src:path#La-Lb`, beside the sentence it supports. Every narrative paragraph, and each "What
it shows" paragraph, is prefixed with its own range in the topic file
(`cite: src:docs/diagrams/<area>/<topic>.md#La-Lb`), so a chapter that cites the corpus's prose
copies that range as well. Each span is re-checked against the working
tree on the way out and a failure is marked `✗`, never dropped; the script exits 1 if any is.
On the rewritten campaignbuilder corpus (declared at `ccbb457`, 2026-10-01) that was 45 topics and 4,586 distinct spans with
none failing, in a fifth of a second. Before it existed, a single-session brief told the local
model to resolve about a thousand citations by hand.

So a refresh has three kinds of step, each its own item in `evals/run-chaptered.sh`:

1. **Plan, per pack.** Read the teaching contract and the current chapter list, read
   `--list`, and write a table to the pack's `PLAN.md`: each chapter kept, merged or dropped,
   and the topic ids it draws on. A chapter whose question the rewritten corpus no longer
   supports is dropped or merged, and the table says why.
2. **Write, per chapter.** Generate the sheet for that chapter's topics, then rewrite the
   chapter from the sheet. Citations are copied as written; a claim with no span in the sheet
   is either cut or written to the pack's `QUESTIONS.md`, not grounded by a fresh search.
3. **Gate and commit, per pack.** The pack's own build, the lint, and one commit.

The rules above still bind the output. The claims ledger cites the source span, which is what
the sheet carries, not the topic. Topic ids live in `PLAN.md` and the production record, never
in reader text. A pack's diagrams are the rendered files the sheet names, read before reuse.

**Every citation a chapter may write must be in the sheet, prose ranges included.** The
first sheets carried code spans only. On the first campaignbuilder refresh (2026-10-01) the
local model still needed corpus-prose citations, so it computed them: in one chapter all ten
landed on the right paragraph, in another both were the sheet's own line numbers passed off as
the topic file's, and the Sonnet review caught them. The sheet now emits a checked range per
paragraph (643 on that corpus, every one landing on its paragraph). The rule for a brief
follows: if a chapter is allowed to cite it, the sheet has already resolved it; anything else is
a question for `QUESTIONS.md`.

**A screen the product labels "mock" shows the mock, not the product.** The same review found a
chapter presenting the mock engine's request parsing (one regex, a default page id) as the
product's rule, because the walk that produced the screenshot ran on the default mock engine.
When a capture or a corpus sentence says a component is mocked, the chapter says so and limits
the claim to what the mock does; what the real component does is a question, not an inference.

**Executing code outranks the corpus, and the code's own comments.** On the same refresh the
corpus and two code comments disagreed about the deploy grant and the *auto* dial. The comments
said "an admin-only, audited act" and "records the signal"; the code reads the grant from an
environment variable on each request and writes an audit event only for escalated signals,
which is what the corpus said. The order of authority is: what executes, then the corpus, then
comments and docs. A disagreement is settled by reading the branch that runs, and the losing
side is filed as drift, never quoted to a reader.

**Read the build before writing the brief.** The first refresh brief asked every chapter to
keep a `covers:` list of topic ids in its front matter. The pack's build reads exactly four
keys (`id`, `order`, `title`, `question`) and ignores the rest, so the instruction would have
cost every chapter a field nothing checks. Anything a brief asks a chapter to carry has to be
something the build or a gate reads. If nothing reads it, it belongs in `PLAN.md` instead.

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
