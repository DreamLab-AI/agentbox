---
name: explainer
description: "Turn a codebase into a proven, grounded explainer for people who did not build it: a docs bundle (three audience documents, a visual page, a queryable RuVector knowledge base), an instructional microsite (evidence-linked source panes, runtime journeys, diagrams, reviewed media), or a video (handed off to codebase-video). Every claim is ledgered to file:line and source, runtime or visual evidence. Use whenever someone asks to explain, document, onboard, hand over or 'make sense of' a repo — 'explain this to the CEO', 'write the handover', 'make an explainer', 'build an instructional microsite', 'client due diligence', 'close a comprehension gap', 'repo primer' — even when they only say 'docs'. Grounded in the Repo-Explainer method (seven-question arc, for-humans/for-ai halves, scope boundary, gates), run locally on private code. Not for a single README edit (write it), a whole-corpus audit (docs-alignment), visual-only polish (design-audit), or a video with no codebase grounding (open-montage)."
---

# Explainer — a proven bundle, not a page of prose

Most repos are written by the people who understand them for the people who
understand them. An explainer is the on-ramp for everyone else, and it is only
worth having if the reader can actually use it afterwards and every claim in it
is grounded. This skill is the family hub for three deliveries that share one
contract and diverge only in output shape.

The first two pilots — one docs bundle, one instructional microsite — were run
against the same private repository in September 2026; their evals live in
`evals/`.

## The seven questions (the acceptance bar)

Whatever the delivery, a reader who finishes it must be able to answer, unaided:

1. What is this?
2. What can you do with it?
3. Why was it built?
4. What problems does it solve?
5. One concrete end-to-end example.
6. Three or four other application areas.
7. How exactly do I run or implement it (a concrete path)?

`references/comprehension-arc.md` has the per-audience adaptation used by the
docs delivery; the microsite and video deliveries adapt the same spine to their
own reader tracks and review questions.

## First, choose the model posture (ask every run)

**Ask before anything else, and ask every run.** Which model reads the source and writes the
draft is a confidentiality decision about someone else's private code, and it is the user's to
take, not one to infer from the harness you happen to be running in, from how the request was
phrased, or from what a previous run chose. There is no default. A run that starts drafting
without having asked has already made the decision.

Use `AskUserQuestion` with exactly these three options, each stating what it costs in
confidentiality and the provenance sentence the delivery will then carry:

| Option | What happens | Confidentiality | Provenance the delivery carries |
|---|---|---|---|
| **Local model — private** | every drafting call goes through the Ontology Loom façade with `loom_options.scaffold=false`, to a model on the LAN | the source never reaches a hosted endpoint; slower, hours of GPU time rather than minutes | made on local hardware |
| **Claude Code native** | the hosted frontier model drafts and verifies directly | the private source is read by a hosted model — only under an engagement whose terms allow it | written by a hosted frontier model, said plainly, as the Repo-Explainer landing page does for its second edition |
| **Combination — escalation** | the local model does the work; a frontier controller reviews and takes over only the packets the local model fails | most of the source stays local; the escalated packets, and only those, reach a hosted model | made on local hardware, with the escalated steps named |

Record the answer in the production record before the first draft call. It then drives three
things, and they are not optional consequences of it:

1. **Which draft path runs** — the Loom-façade batch (`references/delivery-microsite.md`, the
   model-path section, and `references/local-harness.md`) for posture 1 and 3, the session
   model for posture 2.
2. **The provenance sentence** on the delivery's landing page or README, in the wording above.
   A pack that does not say who wrote it is not finished.
3. **A gate**: under posture 1 a hosted drafting call is a fault, not a shortcut. If the local
   path is failing, that is a hand-up (`references/handup.md`), or a question back to the user
   about changing posture — never a quiet escalation.

Posture 3 is posture 1 plus a named exception list, so it inherits the same gate: the
controller answers packets and does not take over the run. `evals/handup-budget.py` bounds how
much of it may be escalated before the posture has stopped being true.

## Orient before you write (an hour, not a day)

Read the root README, the docs index, and any handoff or status document, and
open whatever design record the repo keeps (ADRs). Then **run the project's own
gates** with the stack down (tests, typecheck, coverage, dependency rules) and
write the numbers down with the date and the commit: the explainer must state
test counts as measured, not as the README claims, and the gap between what the
gates cover and what they do not is exactly what a developer document or a
debug pass needs.

Then look for the repository's own diagrams: `scripts/diagram-corpus.mjs --repo <target>`
reports a diagrams-as-code tree if there is one, what it covers, and which of it has gone
stale against HEAD. A corpus is the best scaffold an explainer can have, because someone
who knew the system already decided how it divides into parts; absence is normal and the
script says so and exits 0. Read `references/diagram-corpus.md` before using what it finds:
a corpus is a catalogue at a declared revision, it is usually internal audit material, and
mining it is not the same as shipping it.

If that script finds a corpus, **the diagrams pack is part of the delivery**: fifty topics of
machine-checked drawings are the drawn account of the whole system, and shipping prose about a
system while leaving its own drawings in the repository wastes the best material the target
has. Verify it first with the `diagrams-as-code` skill's generator —
`--check --cite-check --worktree-citations`, which `scripts/diagrams-pack.mjs` runs for you —
and publish what it found, including what it found wrong. The register is the one part that
waits for its owner's agreement (`--no-register`).

If the pack is for the people who use the product, run
`scripts/surface-inventory.mjs --repo <app dir> --out <file>` next. It writes every route a
person can reach and, under each, the headings, buttons, table columns, field labels and
messages that appear there. Do this before deciding chapters: a front end is tens of thousands
of lines, an audience's curriculum is shaped by what the product actually lets them do, and a
local model asked to derive one by reading the code spends its whole budget reading. Two
hundred lines out of thirty-four thousand, in the product's own words — which is also what
makes the chapter titles match the screen and lets the later capture item find the thing.

Compute anything mechanical and hand it in. The session's budget is for judgement, not
discovery.

Search memory first (`memory_search`, namespaces `project-state` and
`personal-context`) for prior decisions about the product, and `search_ruvnet`
for anything in the RuvNet stack the explainer will mention. Do not describe a
RuvNet tool from training data.

## Ground every claim

Every delivery produces a **claims ledger**: `claim → file:line`, one line each,
for the load-bearing statements. Ground each claim in one of three evidence
classes, borrowed from the microsite delivery's evidence-packet discipline and
shared across all three deliveries:

- **source** — a file and line range, opened and read, not guessed;
- **runtime** — a command actually run, its exit status and output;
- **visual** — an actual screenshot or capture, not an assumed one.

When a claim cannot yet be supported, its status is `needs_evidence` (say
exactly what is missing) or `blocked` (the code fails the required behaviour).
Never launder a gap into "out of scope", a "limitation", or silence.

## Stop before fixing product code

By default this skill diagnoses product problems; it does not repair them.
Reproduce the issue, keep the evidence, and stop the affected work. Tell the
user what failed, why it blocks the deliverable, and the concrete proposed
correction, then ask how they want to proceed. Do not implement the fix merely
because Git makes it reversible or because the task includes analysis. Work on
independent material can continue; this rule does not prevent edits to the
explainer deliverable itself. An explicit user override for the current session
takes precedence; do not carry that exception into future runs.

## The ringfence: our instrumentation never enters the target

The skill is DreamLab tooling: forks, RuVector namespaces, ruvbrain grounding,
generated media pipelines. The **target** repo may be a deliberately
conservative stack, and an explainer that leaks our tooling into it conflates
the two in exactly the way its owner likely ringfenced against. So: nothing
lands in the target except the delivery artefacts themselves (documents, the
visual page or site, the video) and plain data fixtures (question sets,
ledgers); passage builders, ingest, graders and checkers live in this skill,
parameterised by target path, never added to the target's tree; the deliverable
describes the target in the target's own vocabulary, never mentioning RuVector,
ruflo, agentbox, forks or this skill; and grounding via `search_ruvnet` is for
our own write-up accuracy, never licence to recommend our stack to the target.

## The gates (A–E)

The headline score is the **lowest** gate; nothing is linked from the repo's docs index,
or presented as finished, until every gate the accepted delivery contract requires is
green. A, B, C and E are the usual set; a contract that names media makes D required too.
`references/gates.md` has the full bars, mechanics and the fail-below-bar
diagnosis loop.

| Gate | Checks | Docs bundle | Microsite | Video |
|---|---|---|---|---|
| A — Knowledge base | graded question sets against the RuVector namespace | `kb/grade.mjs` | — | — |
| B — Comprehension | a fresh, unbriefed reader can state what it is, name three uses, recite the first step | manual audit | the teaching contract's cold-start check | the audience's central question, per `codebase-video`'s own production reference |
| C — Consistency | every ledger line still resolves; no invented route, flag or status | `scripts/check-ledger.sh` | `microsite/completion-audit.md` | editorial review in `review.md` |
| D — Media | audio/video teaches a true beginner | out of scope by default | per delivery choice | `codebase-video`'s own scene-by-scene review satisfies this |
| E — Visuals | each hard concept has an accurate diagram | reader | reader, plus the inspectable source pane | frame inspection at delivery resolution |

## Hand up when a gate stays red

The production run belongs to the local model (today Qwen through the Loom, in a
resumable OpenCode session) so that hours of drafting cost GPU time, not tokens. When a
gate stays red after the capped retries in `references/gates.md`, do not keep retrying
and do not pull a cloud model into the session: write a **hand-up packet** with
`scripts/handup.mjs` and carry on with chapters the packet does not block. A Claude Code
controller polls the queue and answers each packet from a cold start with a minimal fix,
guidance, an override or a block; product defects and budget overruns always go to the
user. An identical retry is not an attempt, and a run that ends with blocked chapters
has ended correctly. `references/handup.md` has the tiers, triggers, packet and reply
shapes, and what the skill-improvement loop reads from them.

## Addendum 2026-09-09: the microsite pilot's verdict, and what changed

The first microsite (the target repository, 20 pages, 180 commits over two days) was grounded,
linked and rejected by its owner: it explained the process of making itself rather than the
code. Its pages described evidence classes, drills, fixtures, receipts, the bugs found while
learning the product's UI, and the narration of its own videos; the reader wanted the system.
Read `references/microsite/reader-voice.md` first on any microsite; it holds the failed
sentences, the corrected chapter shape and the gate. Four things changed:

1. **Two registers.** The claims ledger, evidence classes and completion audit are the
   authors' notebook and never enter the reader text. `scripts/voice-lint.sh` fails a chapter
   that mentions its own making, its evidence, its fixes, or uses "actual"/"real" as trust
   adjectives.
2. **Section by anatomy.** Chapters follow the system's parts (repository, runtime, each
   service, each lane, each console, the tenant, operating it), never the evidence journeys
   the authors happened to run. `scripts/anatomy-coverage.mjs` lists the directories, routes,
   compose services and design records that no chapter mentions.
3. **Chapters are Markdown.** One `chapters/<id>.md` per chapter with front matter, rendered
   by a dependency-free build in the target into the reading shell; `src:path#L10-L20` links
   open the file in the source pane and the build fails on a missing path or a range outside
   the file. Content and shell stay separate; media is added later without touching prose.
4. **The model path.** The Loom façade in verbatim mode answered a codebase packet with an
   ontology class instead of calling the model. The fix went into the Loom (ADR-139):
   `loom_options.scaffold=false` makes the façade a plain proxy for that request.
   `explainer-loom-draft` (a baked binary — no `node`, no install) sends it on every call and
   drives the connected node model through the façade
   (`${LOOM_BASE_URL}`, about 13–20 s for a 400–900-token section) as a
   sequential, resumable background batch; the session model orients, checks ranges and
   decides. See the model-path section in `references/delivery-microsite.md`.

The pipeline that replaced the pilot: per chapter, a researcher writes a fact sheet (files,
exact ranges, ADR sections, pinning tests, measured commands); a writer produces the chapter
from the sheet and the open files; an independent checker opens every linked range, greps
every named identifier, runs the lint and the build, and returns pass or a precise issue list;
a reviser resolves it; the checker runs again. Media is a later pass over an accepted chapter.

## Choose the delivery

| Delivery | Reference | Shape |
|---|---|---|
| Docs bundle | `references/delivery-docs.md` | three audience documents (user, developer, executive), an optional self-contained visual page, and a queryable AI-half knowledge base in RuVector |
| Instructional microsite | `references/delivery-microsite.md` | a locally-served, inspectable reading surface with evidence-linked source panes, verified runtime journeys, diagrams and reviewed media — for onboarding or client due diligence |
| Video | `references/delivery-video.md` | a narrated video explainer; thin — hands off to the standalone `codebase-video` skill with the audience and the claims ledger already gathered |
| The repository's own documentation | `scripts/docs-stack.mjs` | the `docs/` tree the codebase already carries, rendered browsable in the house style: every mermaid block shown as drawn with its source one click below, front matter kept so a topic still names the files it was checked against |
| The repository's own diagrams | `scripts/diagrams-pack.mjs` | the diagrams-as-code corpus as a pack of its own: a front door stating what has been checked, an area level, a page per topic with both narratives and every diagram beside its source and its citation verdict, and the register and the timeline as two further doors |

Pick one delivery per request unless the user asks for more than one; each
reference is self-contained once the shared core above is done.

The documentation stack is not a pack and is not written for anyone: it is the working
documentation of the codebase, made readable. Offer it alongside a pack rather than instead of
one — a pack is a route through a system, and this is the map underneath it. Two passes:

```
node scripts/render-diagrams.mjs --src <docs dir> --cache <dir>          # draw what nothing drew
node scripts/docs-stack.mjs --src <docs dir> --out <dir> --repo <target> \
     --title <product> --diagram-cache <dir>
```

The diagrams pack is the corpus given its own front door rather than a section of someone
else's. It is one invocation, and it runs the corpus's own checker on the way past so the pack
can state what was verified rather than implying it:

```
node scripts/diagrams-pack.mjs --repo <target> --out <dir> --title <product> [--no-render]
```

`--no-render` is right when the corpus already ships rendered SVGs; without it the generator
redraws them. `--no-register` holds back the register until its owner has agreed to it. The
script refuses to claim success: a diagram with no art where rendering was asked for, a link
to a page the pack does not hold, or a placeholder left in the shell each exit 1. It ends with
one line naming the topics, diagrams, citations checked, warnings and revision, which is the
line to quote in the production record. `references/diagram-corpus.md` covers what the pack
shows and what the ringfence still forbids.

A diagrams-as-code corpus normally keeps rendered art beside each topic, but the prose pages
around it — explanations, how-to pages, decision records — carry mermaid inline with no
rendered mirror, because nothing in the repository's workflow needed one. A reader needs one: a
fenced graph definition is not a diagram. The first pass renders those into a content-addressed
cache, marks them as drawn here rather than by the repository, and reports any whose source does
not parse. Say so on the page where the picture would have been. Three unparseable diagrams is a
finding about the repository, and more use to whoever maintains it than a silence.

For a hard concept whose change over time needs explanation, use
[manim](../manim/SKILL.md) after the relevant claims and chapter are accepted.
Its [handoffs](../manim/references/handoffs.md) cover optional playback, named
steps and static alternatives in a knowledge page, or clips for the video owner.

## Model-fit

This section describes the tiers, not the choice between them: which one drafts is settled by
the posture question at the top of this file, asked every run. What follows is what each
posture is like to run in.

**Production tier:** the long run is designed for a local OpenAI-compatible model with
tool calls (OpenCode profile `loom-agent/current`); it discovers this skill and its
specialists through the normal catalogue and hands up by packet when stuck. Such a harness
usually has a shell and little else, so read `references/local-harness.md` before reaching
for a capability: resolve it as a skill, then as a documented service, then hand up. Do not
hand-roll a browser, encoder or renderer; work produced that way carries no receipt and
cannot be reviewed. Work chapter by chapter in separate sessions rather than one long one,
so context stays bounded and a failure costs one chapter. Claude Code
and Codex are the controller and grader tiers, not the drafter, unless the user says so.

**Claude Code only:** the docs delivery's parallel-authoring step needs the
Agent/fork tool (`subagent_type: fork`) to write the three audience documents
from a shared orientation context. On Codex / GPT-6 Astra, which has no fork
tool: write the three documents sequentially in one session instead, re-reading
the orientation notes before each one so the registers stay distinct. See
`references/delivery-docs.md` step 2 for the full fallback.

## Record

Store the deliverable's location, gate status and the decisions it surfaced in
`project-state` via `memory_store`, so the next session and the rest of the
mesh find it. Each delivery reference repeats this as its final step.

## Resources

- `references/delivery-docs.md` — the docs-bundle workflow, its own resources
  and scripts.
- `references/delivery-microsite.md` — the instructional-microsite workflow,
  evidence model and media production.
- `references/delivery-video.md` — the video handoff to `codebase-video`, the make/see/revise loop for visual work, and `scripts/asset-gate.mjs`.
- `references/comprehension-arc.md` — the seven questions, per audience.
- `references/gates.md` — the five gates, bars and ledger format in full.
- `references/handup.md` — escalating a red gate to a stronger tier by packet, not by session; `scripts/handup.mjs`.
- `references/diagram-corpus.md` — mining the repository's own diagrams-as-code tree, and shipping it as a pack; `scripts/diagram-corpus.mjs`, `scripts/diagrams-pack.mjs`.
- `scripts/lib/markdown.mjs` — the dependency-free Markdown renderer the diagrams pack builds on: GitHub heading slugs, GFM tables, and fenced blocks handed to the caller so a mermaid block can become a picture.
- `references/local-harness.md` — running where the specialists are not tools: skill, then documented service, then hand up.
- `evals/evals.json` — the pilot eval prompts for this skill.
