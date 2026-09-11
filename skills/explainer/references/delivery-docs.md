# Delivery: docs bundle

Steps 1–6 of the docs-bundle workflow. Do the hub's shared orientation
(`SKILL.md`, "Orient before you write"), claims-ledger grounding, ringfence and
gates before and during this workflow — they are not repeated here. The output
is:

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

The `kb/` directory in the target holds **only** the question sets and a
README; the build, ingest and grading scripts stay in this skill (see the
hub's ringfence).

## Lineage, and what not to do

This is ruvnet/Repo-Explainer's **method** (Stuart Kerr, 2026): the
seven-question comprehension arc, the `for-humans/` + `for-ai/` bundle, the
scope boundary, "done means proven with evidence". Its **pipeline** is not
used: it clones a public URL, authors each section with one gpt-4o prompt over
a README excerpt, gates on structure (file exists, page over 5,000 chars, no
secrets), and publishes to a public GitHub repo and domain. For private or
client code that path is a leak, and for any code it produces confident prose
with no grounding. Keep the arc and the gates; replace the prompt loop with
grounded authoring. See [lineage.md](lineage.md) for the full comparison.

## 1. Scaffold the bundle

Create the tree above with a README in each directory saying what will live
there and its status (`NOT BUILT` / `DRAFT` / `GATED`). Status lines are
load-bearing: a reader who lands on a half-built bundle must be able to tell
what is trustworthy.

## 2. Author the three documents in parallel, grounded

Spawn **three forks** (they inherit your orientation) with the prompt
templates in [audience-prompts.md](audience-prompts.md). Each fork:

- writes exactly one file and touches nothing else;
- opens every file it cites, never guesses a function name, route, flag or
  status;
- states plainly what is fail-closed, designed-but-not-built, or blocked on
  someone;
- returns a **claims ledger**: the 10–15 most load-bearing claims as
  `claim → file:line`.

Write each ledger to `gates/ledgers/<audience>.md` with the date and commit.
The ledgers are how a second reader checks the document without re-deriving
it, and they are where documents disagree with each other or with the code.
Expect that: in the first instance, the executive draft said the user "is
told" of a review park and the user draft, having read the chat route, found
no such message exists. The ledger caught it; the fix was one sentence and a
new debug item.

Style for all three: UK English, plain, one idea per sentence, no em-dashes,
no AI-tell vocabulary (`scripts/style-check.sh` flags the usual words), no
superlatives, honest about what is not built. Warm is fine; puffery is not.

**Claude Code only:** this step needs the Agent/fork tool (`subagent_type:
fork`) to run the three audience documents in parallel from a shared
orientation context. On Codex / GPT-6 Astra, which has no fork tool: write the
three documents sequentially in one session instead, re-reading your
orientation notes before starting each one so the registers stay distinct even
without separate contexts.

## 3. Build the AI half

[kb-recipe.md](kb-recipe.md) is the recipe. The short version: walk **only the
repo's own authored tree** (the scope boundary; vendored or tenant code is
excluded except its README), chunk at structure boundaries (function, class,
heading) to ≤ 512 tokens with a `source_type` tag on every passage, and ingest
into RuVector namespace `<repo>-kb` using the same client-side embedding path
as `agentbox/scripts/ruvnet-brain-ingest.mjs`. Tests and examples go in: they
are the best usage documentation a repo has. After any bulk ingest, the index
law applies (non-concurrent HNSW rebuild, then the recall gate).

Then write two question sets, 3–4 per arc stage, with `wantPaths`,
`mustContain` and `forbidden` tokens **verified to exist in source before
authoring** — a guessed `mustContain` is a bug in the question. `tuned.jsonl`
may be consulted while tuning; `heldout.jsonl` never, so the score cannot be
overfitted.

## 4. Build the visual page (if the reader is not a repo reader)

One self-contained HTML file: hero, three doors as tabs rendering the three
documents, one diagram per hard concept, real screenshots embedded as data
URIs, the honest built / blocked / deferred table, provenance (commit and
date). No external scripts or styles; light and dark themes explicit. Publish
it as a **private** Artifact; sharing the link is the owner's decision, say so
rather than deciding it.

## 5. Gate, then link

[gates.md](gates.md) defines the five gates in full, including the
fail-below-bar diagnosis loop; the headline score is the **lowest** gate and
nothing is linked from the repo's docs index until A, B, C and E are green.

Before finishing, `git status` the target: tool state (`.claude-flow/`,
`.agentic-qe/`, `.claude/`) must be ignored or absent, per the hub's ringfence.

## 6. Record

Store the bundle's location, gate status and the decisions it surfaced in
`project-state` via `memory_store`, so the next session and the rest of the
mesh find it.

## Why the forks, and why the ledgers

A single agent writing three audiences from one context flattens them into one
voice and one level of detail; three forks that share the orientation but
write alone keep the registers distinct. The ledger is what makes a fork's
confidence checkable: without it a reviewer either re-derives the document or
trusts it, and both are how explainers go stale with confidence. The debug
findings that drop out of ledger disagreements are not a side effect; they are
half the value of writing the explainer at all.

## Resources

- [comprehension-arc.md](comprehension-arc.md) — the seven questions, per
  audience.
- [audience-prompts.md](audience-prompts.md) — the three fork prompt
  templates, ready to fill.
- [gates.md](gates.md) — the five gates, bars, and the ledger format.
- [kb-recipe.md](kb-recipe.md) — scope boundary, chunking, ingest, question
  sets, grading.
- [lineage.md](lineage.md) — what Repo-Explainer does, what was kept, what was
  dropped.
- `scripts/style-check.sh <file…>` — em-dash and AI-tell vocabulary count.
- `scripts/check-ledger.sh <ledger.md> <repo-root>` — gate C: every `path:line`
  exists and prints the cited line for review.
- `scripts/check-links.sh <doc…>` — relative links resolve.
- `scripts/kb/` — (day 2, not yet on disk) `build-passages.mjs <target>
  <out.jsonl>`, `ingest.mjs <passages> <namespace>`, `grade.mjs <namespace>
  <questions…>`; run from here, pointed at the target. <!-- lint-ok: deliberate
  day-2 forward reference; the kb scripts are planned, not shipped -->
