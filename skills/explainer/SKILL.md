---
name: explainer
description: "Turn a codebase into a proven, dual-audience explainer bundle: a human half (three audience documents — user, onward developer, executive — plus one self-contained visual page) and an AI half (the repo's own tree ingested into a RuVector namespace so agents answer from source), every claim ledgered to file:line and passed through quality gates before it is called done. Use this whenever someone asks to explain, document, onboard, hand over, or 'make sense of' a repo or product for people who did not build it — 'explain this to the CEO', 'write the handover', 'onboarding doc for the next dev', 'what does this product actually do', 'make an explainer', 'welcome mat', 'repo primer' — even when they only say 'docs'. Grounded in the Repo-Explainer method (seven-question comprehension arc, for-humans/for-ai halves, scope boundary, gates) but run locally on private code; never the hosted public pipeline. Not for a single README edit (write it), a whole-corpus Diátaxis audit (docs-alignment), or a visual-only polish (design-audit)."
---

# Explainer — a proven bundle, not a page of prose

Most repos are written by the people who understand them for the people who
understand them. An explainer is the on-ramp for everyone else, and it is only worth
having if a newcomer can actually answer the seven questions afterwards and an agent
can actually use the thing. So the output is a **bundle with two halves and a gate**,
not a document.

```
<repo>/docs/explainer/
├─ README.md            index: three doors, the seven questions answered once, gate status
├─ for-users.md         human half · whoever uses the product day to day
├─ for-developers.md    human half · whoever inherits the code
├─ for-executives.md    human half · whoever signs it off
├─ site/                human half · one self-contained HTML page (optional, day 3)
├─ kb/                  AI half · passages → RuVector namespace <repo>-kb, question sets, grader
├─ gates/ledgers/       claim → file:line, one ledger per document; gate C reads them
└─ assets/              diagrams the page and the documents share
```

The `kb/` directory in the target holds **only** the question sets and a README; the
build, ingest and grading scripts stay in this skill (see the ringfence below).

The first instance is `co-created/campaignbuilder/docs/explainer/` (tranche 2, Sep 2026);
read it when you want to see the shape filled in.

## Lineage, and what not to do

This is ruvnet/Repo-Explainer's **method** (Stuart Kerr, 2026): the seven-question
comprehension arc, the `for-humans/` + `for-ai/` bundle, the scope boundary, "done means
proven with evidence". Its **pipeline** is not used: it clones a public URL, authors each
section with one gpt-4o prompt over a README excerpt, gates on structure (file exists,
page over 5,000 chars, no secrets), and publishes to a public GitHub repo and domain.
For private or client code that path is a leak, and for any code it produces confident
prose with no grounding. Keep the arc and the gates; replace the prompt loop with
grounded authoring. See `references/lineage.md` for the full comparison.

## The seven questions (the acceptance bar)

A newcomer who reads the human half must be able to answer, unaided:

1. What is this?
2. What can you do with it?
3. Why was it built?
4. What problems does it solve?
5. One concrete end-to-end example.
6. Three or four other application areas.
7. How exactly do I run or implement it (a concrete path)?

Every audience document follows this spine, adapted to what that reader needs from each
question. The index answers all seven once, briefly, so the bundle has a backbone.
`references/comprehension-arc.md` has the per-audience adaptation.

## Workflow

### 0. Orient before you write (an hour, not a day)

Read the root README, the docs index, and any handoff or status document, and open
whatever design record the repo keeps (ADRs). Then **run the project's own gates** with
the stack down (tests, typecheck, coverage, dependency rules) and write the numbers
down with the date and the commit. Two reasons: the explainer must state test counts as
measured, not as the README claims; and the gap between what the gates cover and what
they do not is exactly what the developer document and any debug pass need.

Search memory first (`memory_search`, namespaces `project-state` and `personal-context`)
for prior decisions about the product, and `search_ruvnet` for anything in the RuvNet
stack the explainer will mention. Do not describe a RuvNet tool from training data.

### 1. Scaffold the bundle

Create the tree above with a README in each directory saying what will live there and
its status (`NOT BUILT` / `DRAFT` / `GATED`). Status lines are load-bearing: a reader
who lands on a half-built bundle must be able to tell what is trustworthy.

### 2. Author the three documents in parallel, grounded

Spawn **three forks** (they inherit your orientation) with the prompt templates in
`references/audience-prompts.md`. Each fork:

- writes exactly one file and touches nothing else;
- opens every file it cites, never guesses a function name, route, flag or status;
- states plainly what is fail-closed, designed-but-not-built, or blocked on someone;
- returns a **claims ledger**: the 10–15 most load-bearing claims as `claim → file:line`.

Write each ledger to `gates/ledgers/<audience>.md` with the date and commit. The
ledgers are how a second reader checks the document without re-deriving it, and they
are where documents disagree with each other or with the code. Expect that: in the first
instance, the executive draft said the user "is told" of a review park and the user
draft, having read the chat route, found no such message exists. The ledger caught it;
the fix was one sentence and a new debug item.

Style for all three: UK English, plain, one idea per sentence, no em-dashes, no AI-tell
vocabulary (`scripts/style-check.sh` flags the usual words), no superlatives, honest
about what is not built. Warm is fine; puffery is not.

### 3. Build the AI half

`references/kb-recipe.md` is the recipe. The short version: walk **only the repo's own
authored tree** (the scope boundary; vendored or tenant code is excluded except its
README), chunk at structure boundaries (function, class, heading) to ≤ 512 tokens with a
`source_type` tag on every passage, and ingest into RuVector namespace `<repo>-kb`
using the same client-side embedding path as `agentbox/scripts/ruvnet-brain-ingest.mjs`.
Tests and examples go in: they are the best usage documentation a repo has. After any
bulk ingest, the index law applies (non-concurrent HNSW rebuild, then the recall gate).

Then write two question sets, 3–4 per arc stage, with `wantPaths`, `mustContain` and
`forbidden` tokens **verified to exist in source before authoring** — a guessed
`mustContain` is a bug in the question. `tuned.jsonl` may be consulted while tuning;
`heldout.jsonl` never, so the score cannot be overfitted.

### 4. Build the visual page (if the reader is not a repo reader)

One self-contained HTML file: hero, three doors as tabs rendering the three documents,
one diagram per hard concept, real screenshots embedded as data URIs, the honest
built / blocked / deferred table, provenance (commit and date). No external scripts or
styles; light and dark themes explicit. Publish it as a **private** Artifact; sharing the
link is the owner's decision, say so rather than deciding it.

### 5. Gate, then link

`references/gates.md` defines the five gates. The headline score is the **lowest** gate,
and nothing is linked from the repo's docs index until A, B, C and E are green:

- **A** knowledge base — graded answers on both question sets, every stage ≥ 95, overall ≥ 98;
- **B** comprehension — a fresh agent role-plays each audience on the rendered output and must say what it is, name three uses, recite the first concrete step, and confirm every hard concept has a visual;
- **C** consistency — every ledger line still says what the claim says (`scripts/check-ledger.sh`), built-vs-designed matches the README, links resolve, no invented identifiers;
- **D** media — out of scope unless asked;
- **E** visuals — each hard concept has an accurate diagram that renders where the reader reads.

### 6. Record

Store the bundle's location, gate status and the decisions it surfaced in
`project-state` via `memory_store`, so the next session and the rest of the mesh find it.

## The ringfence: our instrumentation never enters the target

The skill is DreamLab tooling: forks, RuVector namespaces, ruvbrain grounding, and, in
time, Rust helpers under `agentbox/services/skill-tools`. The **target** repo may be a
deliberately conservative pipeline (campaignbuilder is Node, TypeScript, Docker Compose,
Vercel; no Rust, no WASM, no RuvNet runtime), and an explainer that leaks our stack into
it conflates the two in exactly the way its owner ringfenced against. So:

- Nothing lands in the target except the explainer documents, the visual page, and plain
  data fixtures (the question sets, the ledgers). Passage builders, ingest, graders and
  checkers live **here**, parameterised by target path and namespace, never in the
  target's tree, and never add a dependency, a tool directory or a config file to it.
- The documents describe the target in the target's own vocabulary and design record.
  They do not mention RuVector, ruflo, agentbox, forks or this skill; the AI half is
  described in the target's index as "a queryable knowledge base held by DreamLab" with
  a pointer, not as part of the product.
- Grounding for RuvNet-stack facts (via `search_ruvnet`) is for **our** write-up
  accuracy when the target genuinely uses that stack; it is not a licence to compare the
  target to it or recommend it.
- Before finishing, `git status` the target: tool state (`.claude-flow/`, `.agentic-qe/`,
  `.claude/`) must be ignored or absent, and the only untracked additions are the ones
  above.

## Why the forks, and why the ledgers

A single agent writing three audiences from one context flattens them into one voice
and one level of detail; three forks that share the orientation but write alone keep
the registers distinct. The ledger is what makes a fork's confidence checkable: without
it a reviewer either re-derives the document or trusts it, and both are how explainers
go stale with confidence. The debug findings that drop out of ledger disagreements are
not a side effect; they are half the value of writing the explainer at all.

## Resources

- `references/comprehension-arc.md` — the seven questions, per audience.
- `references/audience-prompts.md` — the three fork prompt templates, ready to fill.
- `references/gates.md` — the five gates, bars, and the ledger format.
- `references/kb-recipe.md` — scope boundary, chunking, ingest, question sets, grading.
- `references/lineage.md` — what Repo-Explainer does, what was kept, what was dropped.
- `scripts/style-check.sh <file…>` — em-dash and AI-tell vocabulary count.
- `scripts/check-ledger.sh <ledger.md> <repo-root>` — gate C: every `path:line` exists and prints the cited line for review.
- `scripts/check-links.sh <doc…>` — relative links resolve.
- `scripts/kb/` — (day 2) `build-passages.mjs <target> <out.jsonl>`, `ingest.mjs <passages> <namespace>`, `grade.mjs <namespace> <questions…>`; run from here, pointed at the target.
