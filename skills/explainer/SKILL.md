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
   `scripts/loom-draft.mjs` sends it on every call and drives the connected node model through the façade
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

Pick one delivery per request unless the user asks for more than one; each
reference is self-contained once the shared core above is done.

For a hard concept whose change over time needs explanation, use
[manim](../manim/SKILL.md) after the relevant claims and chapter are accepted.
Its [handoffs](../manim/references/handoffs.md) cover optional playback, named
steps and static alternatives in a knowledge page, or clips for the video owner.

## Model-fit

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
- `references/diagram-corpus.md` — mining the repository's own diagrams-as-code tree; `scripts/diagram-corpus.mjs`.
- `references/local-harness.md` — running where the specialists are not tools: skill, then documented service, then hand up.
- `evals/evals.json` — the pilot eval prompts for this skill.
