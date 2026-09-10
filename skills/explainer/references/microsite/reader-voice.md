# Reader voice: explain the system, not the making of the explanation

The September 2026 microsite pilot (campaignbuilder, 20 pages, 180 commits) produced
pages that were accurate, linked to source and almost useless to their reader. They
described the process of producing the site: the evidence it had gathered, the drills it
had run, the bugs it had found while learning the product's interface, and the standards
by which its own claims should be judged. The voice lint (`scripts/voice-lint.sh`) scored
the four sample pages at 19, 82, 27 and 46 hits. The reader wanted to understand the
code. This reference separates the two jobs the pilot conflated.

## Two registers, one direction of flow

| Register | Audience | Lives in | Content |
|---|---|---|---|
| Ledger | the authoring agents and the completion audit | `production/`, `evidence/`, the claims ledger, memory | evidence classes, hashes, runtime receipts, fixture identities, findings, before/after, what was not tested |
| Reader | whoever the delivery names: an engineer inheriting the code, an executive assessing it, a user of it | `chapters/*.md` and the rendered pages | what the system does, why (design record), and — for a reader who will open files — where (file:line) and what to read first |

The ledger constrains the reader text (a sentence with no supporting range does not
ship). The ledger never appears in the reader text. The pilot let it leak: every
paragraph ended by qualifying what its evidence did not prove.

## Antipatterns, with the pilot's own sentences

**Evidence epistemics as content.** "This does not establish the deployed configuration."
"Neither 'verified' nor 'reported' implies that every possible check ran." "Questions this
result does not close." The reader did not ask what the author could prove; they asked
what the code does. Delete the sentence, or restate it as a property of the system with a
link: "The gate's queue is per process, not a database lock (`src:…`)."

**Drill and fixture narration.** "What this demonstration actually runs." "Reproduce the
drill." "The observer checks the database container's task label, starts two isolated
control-plane processes in sequence…" This describes the harness built to produce the
page. It belongs in `production/`.

**Bug history.** "The HTTP application tests include the earlier regression where intake
did not track a reachable row at all." "F019 corrected." The reader inherits the code at
HEAD. Fixes made while writing are the author's diary.

**Trust adjectives.** "the actual executor", "the real renderer", "actual gate-invoked
capture", "real components". Anxiety about slop expressed as vocabulary. Name the thing:
"the executor", "the renderer".

**Fixture data as canon.** "A named Northpoint variant received a shortcode." "A separate
synthetic Beacon example." Test fixtures are not the product; a reader will grep for
Northpoint and find a seed file.

**Media provenance in the prose.** "British male narration: bm_george. The edits are
scripted; this is an explanation of the module drill, not an operator-screen recording."
Captions and transcripts carry their own metadata; the chapter does not.

**Interface tutorial for the author's own widgets.** "Choose Play sequence or Next step."
"Use Next step to pause at each responsibility." The reader is learning a codebase, not a
slideshow control.

**Evidence taxonomy on the front page.** "Source-backed / Test-observed /
Runtime-observed" as the first thing a visitor reads. Keep it in the completion audit.

**Sectioning by evidence journey instead of by system anatomy.** Twelve "review topics"
organised around what had been demonstrated ("Publication and partial failure", "Render
refusal and recovery") rather than around what exists (control plane, identity, lanes,
engine, custody, tenancy, enclosure, operator console, tenant). A newcomer navigates a
system by its parts.

## Patterns worth keeping from the pilot

- A question as the chapter eyebrow ("Who judges an edit and who can undo it?").
- Vocabulary and actors before mechanism; "why" (the ADR) before "how" (the code).
- A source pane beside the text that opens the cited file at the cited lines, from the
  reader's own checkout, so trust comes from reading rather than from adjectives.
- Response-code and state tables that map a value to its meaning.
- Offline, dependency-free reading (system fonts, no CDN, one Python launcher).
- The design tokens (paper, ink, muted teal) and the 76ch reading measure.

## The chapter shape, and how the audience changes it

The spine is the same for every reader. A question as the eyebrow, a direct answer in two
to four sentences before any heading, the decision before the mechanism, and a closing
section that tells the reader what to do next. What fills each section, and how long the
chapter runs, comes from the audience decision made at the start of the delivery. Do not
carry one audience's shape to another; the pilot's engineer shape below is an instance,
not the template.

```
---
id: identity            # file name, also the page name
order: 5
title: Identity and authorisation
question: Why does signing in not grant permission?
---
<Direct answer, 2–4 sentences, no heading.>
## Why it is this way        <the decision, linked to its design record>
## How it works              <the mechanism, in the depth this reader needs>
## <optional: the state machine, the routes, the services>
## What to do next           <the concrete step this reader would actually take>
## Traps                     <3–6 surprises, each grounded; properties of the system,
                              never of the evidence>
```

| Reader | Mechanism section | What to do next | Source links | Length |
|---|---|---|---|---|
| Engineer inheriting the code | walk the code; every mechanism sentence carries a `src:` link | 3–6 files to read first, one line each | inline, in the reading path | 900–1,600 words |
| Executive or investor assessing it | the behaviour and the decision, in the product's own vocabulary; no file names in the prose | the one thing to try, or the question to put to the team | below the reading path, in an optional inspection layer | 500–900 words |
| User of the product | what they can do and what happens when they do it | the task they came to perform | none in the prose | 400–800 words |

Present tense, UK English, sentences around 20 words, product terms defined on first use.
Link syntax `[text](src:path#L10-L20)`; the build rejects a missing path or a range outside
the file, and the checker rejects a range that does not support its sentence — whichever
layer the link sits in.

A note on the lint. It bans the vocabulary of authorship, and some products genuinely own
those words: an audit hash chain, a checkpoint, a published video. Pass the engagement's
product vocabulary with `voice-lint.sh --allow <file>`, listing phrases rather than bare
words, so "audit hash chain" is allowed while "hash" stays banned everywhere else. Adding a
bare word to that file to clear a hit is how the lint stops working.

## The gate

A chapter ships when all four hold:

1. `voice-lint.sh` reports `hits=0` (self-reference, evidence words, history, hedges,
   trust adjectives, media, slop vocabulary).
2. The build passes (every `src:` path exists, every range is inside its file, every
   chapter link is in the map).
3. An independent checker opened every linked range and confirmed it supports the
   sentence, grepped every named identifier, and found the "must cover" list addressed.
4. `anatomy-coverage.mjs` reports no part of the system (source directory, route, compose
   service, ADR) that no chapter mentions, or the omissions are listed deliberately.

## Where the ledger goes instead

The author's notebook never enters the target. Scripts, receipts, raw outputs, the claims
ledger and the completion audit live in the engagement workspace from the first day, beside
the fixtures, not in the target with a promise to move them at close-out: a temporary
directory in someone else's repository is a directory that gets committed. What the target
receives is the reader's material only — the chapters, the shell, the launcher, whatever
index the source pane needs, and the media that shipped.

The one thing that does legitimately land in the target is the build the reader needs to
read a clean clone: a dependency-free renderer and its launcher, owned by the deliverable
and named in it. That is a delivery artefact, not instrumentation. Everything that exists
to check the work — linters, coverage scripts, graders, the hand-up tool — stays in the
skill, parameterised by target path.
