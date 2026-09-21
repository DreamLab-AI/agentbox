# `tests/system-one/` — the SSO measurement corpus and consumer-compatibility gates

Artefacts for ADR-2094 (Sovereign System One) and the frozen SSO interface contract.
Two audiences read this directory: `node --test` here, and `crates/system-one/` in Rust
(`system-one-client` parses `golden/`, `system-one-eval` runs `routing-cases.json`).

```
routing-cases.json        86 labelled routing cases  — the eval corpus
golden/                   9 wire fixtures + manifest.json — the protocol fixtures
consumer-compat.test.mjs  the shipped router library, unchanged, against an SSO-shaped judge
golden-fixtures.test.mjs  §2 hard rules over every fixture
routing-corpus.test.mjs   the corpus validated as an artefact (not as an accuracy claim)
```

Run everything:

```bash
node --test "tests/system-one/*.test.mjs"
```

(The glob is deliberate: `node --test tests/system-one` resolves the directory as a
module in this repo and fails before running anything.)

## Read this before quoting a number from the corpus

**A self-authored corpus flatters the system that authored it.** Most of these cases
were written in this repository, by an agent that could read the very skill
descriptions the router is scored on choosing between. When the author of the question
has seen the answer key, a high score measures agreement with the author, not routing
quality. Nothing in `routing-cases.json` is an independent benchmark, and no number
derived from it should be reported without this paragraph attached.

What it *is* good for: **parity**. Running the identical corpus against cloud Jev and
against the local façade and diffing the two is a valid measurement, because whatever
bias the corpus carries, it carries equally for both backends. That is the question
ADR-2094 actually has to answer — *does the local judge agree with the cloud one?* — and
this corpus can answer it. Treat absolute accuracy as a sanity floor, never as evidence.

### Provenance, case by case

Every case declares one tier in its `provenance` field. Counts as of 86 cases:

| tier | n | what it is | how independent |
|---|---|---|---|
| `items-json-tier-A` | 9 | Verbatim prompts from `skills/system-one/scripts/items.json` tier A, authored in earlier sessions for a different task, before this corpus existed. | The only genuinely independent prompts here. Nobody wrote them knowing they would be scored. |
| `directory-derived` | 63 | Written from the *When to Choose* / *NOT for* columns of `skills/SKILL-DIRECTORY.md`. | Independent of the text under test — the router scores the frontmatter `description`, and the directory table is authored separately — but not independent of this repo, and written by the same agent that built the corpus. **These are the invented cases.** |
| `log-shaped` | 14 | Conversational turns written to match the *shape* of the 66 `none` picks and 13 `short-prompt` skips in `~/.claude/skill-route.jsonl`. | Shape only. The router log records outcomes — choice, confidence, tokens, cost — and **never the prompt text, by design**. No user turn has been recovered; none could be. |

So: **9 cases derive from a pre-existing authored set, 14 are modelled on the real
routed-turn distribution without reproducing any of it, and 63 are invented here.**
The real distribution informed the corpus in exactly one way that can be stated
precisely: 115 logged turns — 101 routed (66 of them `none`), 13 skipped as too
short, 1 with the router off — every route over exactly 115 candidates at a median
14,701 input tokens — which is why `none` is 16 of the 86 labels rather than a token
handful, and why prompt lengths sit in the range the log records.

### Class mix

| class | n | meaning |
|---|---|---|
| `near-neighbour` | 50 | Two or more skills plausibly apply; the label is the one whose stated boundary fits. This is where routing is actually hard. |
| `boundary` | 12 | Looks like a skill's territory and is not. Some of these are labelled `none`. |
| `single` | 10 | One skill obviously applies. A router that misses these is broken, not miscalibrated. |
| `none` | 14 | No skill would change how a capable assistant approaches the turn. |

## The `late_discriminative` subgroup — 41 of 86 cases

`laya` truncates **every option to 48 tokens, unconditionally**, before any budget logic
runs (`laya/common.py:build_sequence`; SSO contract §10.1). Our median skill description
is 461 chars ≈ 115 tokens, so a naive integration amputates roughly 60% of each rubric,
tail-first and mid-sentence — and the tail is frequently where a description says what
it is *not* for. That is precisely the information a near-neighbour decision turns on.

A case is flagged `late_discriminative: true` when **the expected skill's rubric is
longer than the cut AND its first when-to-use / when-NOT-to-use boundary clause begins
after the cut**, so naive truncation would remove the clause that makes the label
correct. The computation is mechanical and re-derived on every test run
(`routing-corpus.test.mjs`), never hand-judged:

- the cut is **48 tokens ≈ 192 chars**, using the estate's own datum that a 461-char
  description is ≈115 tokens (≈4 chars/token). It is an *estimate* of a tokenisation,
  not a tokenisation — no wordpiece tokeniser is available offline in this container.
  The façade reports the real compressed token count in `sso.shortlisted`, and that
  number, not this one, is the operational figure;
- the boundary clause is located by the marker set
  `use when | use for | use after | not for | never for | do not use | don't use |
  rather than | instead of | when not | not when | use only` (case-insensitive);
- a rubric with **no** marker at all and length over the cut is flagged too: if nothing
  explicitly states the boundary, the discriminative material is diffuse and truncation
  takes an unknown share of it.

34 of the 64 distinct labelled skills are flagged, giving 41 of 86 cases —
27 `near-neighbour`, 8 `single`, 6 `boundary`, 0 `none`.

**`system-one-eval` must report this subgroup separately.** It is the subgroup that
distinguishes a façade which deliberately compresses each rubric (contract §10.1,
front-loading the discriminative clause) from one that lets the tokeniser amputate it.
A headline accuracy figure averages the two populations and hides exactly the failure
the façade exists to prevent. The subgroup is never *excluded* from the headline — it
is reported alongside it.

## `golden/` — protocol fixtures

Nine wire documents, both shapes (`typesafe-*`, `sso-*`), success and error, indexed by
`golden/manifest.json`. Metadata lives in the manifest and never inside a fixture, so
each fixture is a pure contract-§2 document a strict deserialiser can take whole.

They are **synthesised from the contract, not recorded from the wire** — see
`manifest.json` `_origin` for the full statement and the real scalar values they borrow
from the router log. They are evidence that our parsers agree with the documented
contract; they are not evidence that the cloud emits these exact bytes. The first live
call against either backend should be captured and diffed against them.

Do not rename or move a fixture without telling whoever is writing the Rust client:
both languages read these paths.

## What these tests do not cover

- **No live call.** Nothing here contacts `api.typesafe.ai`, the façade or the engine.
  Integration against a running sidecar is contract §8.4 and belongs elsewhere.
- **No accuracy assertion.** No test here asserts that the router picks the labelled
  skill. That number comes from `system-one-eval` against a live backend, and it means
  nothing without the caveats above.
- **No tokenisation.** The 4-chars-per-token figure is an estimate, stated as one.
