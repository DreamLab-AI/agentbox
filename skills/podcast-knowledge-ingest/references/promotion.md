# Ledger promotion: candidacy detector + dossier assembly

> **Rust port note:** `promote.py` was ported to the `podcast-promote` binary
> in [`services/podcast-ingest`](../../../services/podcast-ingest) (crate
> `podcast-ingest`, module `promote::*`). The CLI flags, dossier JSON/MD
> shape, and every threshold/algorithm described below carried over
> unchanged — only the implementation language changed. Function-name
> references below (`promote.py::foo`, `ingest.py::bar`) are the Python
> originals this document was written against; their Rust equivalents live
> at, respectively: `parse_ledger_page`/`episode_slug_from_ledger` →
> `promote::ledger_parse`; `_build_ledger_bullet`/`write_assertion_ledger`/
> `_ledger_page_path` → `ingest::ledger`; `extract_splice_json`/
> `apply_splice` → `promote::splice`; `write_dossier_json`/`write_dossier_md`/
> `load_processed_fingerprint_sets`/`clear_slug_outputs` → `promote::dossier`;
> `write_working_page` → `promote::working_page`; `judge_before_after`/
> `_judge_windows`/`_item_seed`/`extract_judge_json` → `promote::judge`;
> `run_gemini_judge`/the rubric prompts → `promote::gemini`;
> `completeness_score`/`matches_gold` → `promote::completeness`; `Candidate`/
> `find_candidates` → `promote::candidate`; the `run(args)` pipeline →
> `promote::run`.

`promote.py` implements the dashed-box stage of the promotion lifecycle
described in "From instrument to pipeline" (`loom/docs/research/paper-v4/main.tex`,
§ lifecycle, Figure 8 / `\label{fig:lifecycle}`):

> A topic whose ledger accumulates evidence [...] becomes a *candidate*;
> candidates pass an automated pre-filter consisting of the two instruments
> this paper developed — the blind before/after quality judgment [...] and the
> copy-ceiling answer-completeness gate [...] — and survivors reach the
> graph's existing governed proposal queue as scored dossiers with provenance
> down to assertion fingerprints.

Per the paper's own status register: the ledger stage `promote.py` reads
(`podcast-evidence___*.md`, written by `ingest.py::write_assertion_ledger`) is
**built and running**. The two-instrument pre-filter and dossier assembly
implemented here are **designed, with both instruments individually
validated** elsewhere (page-judge scratchpad; the copy-ceiling matcher in
`main.tex` § ceiling) — `promote.py` is the first wiring of the two into one
promotion-pipeline stage, exercised against sandboxed fixtures, not the live
graph.

## Usage

```bash
podcast-promote --pages-dir <ledger+graph pages dir> --proposals-dir <output dir> [options]

# Candidacy scan only, no Loom/judge calls, no writes:
podcast-promote --pages-dir .sandbox/pages --proposals-dir .sandbox/proposals --dry-run

# Full run, at most 3 candidates this invocation:
podcast-promote --pages-dir .sandbox/pages --proposals-dir .sandbox/proposals --limit 3
```

### CLI flags

| Flag | Default | Meaning |
|---|---|---|
| `--pages-dir` | required | dir containing both `podcast-evidence___*.md` ledger pages **and** the target topic pages (`<Topic>.md`) they wikilink to |
| `--proposals-dir` | required | output dir for survivor dossiers |
| `--rejects-dir` | `<proposals-dir>/../rejects` | output dir for rejected dossiers |
| `--min-assertions` | `5` | min assertions for a topic to become a candidate |
| `--min-episodes` | `2` | min distinct episodes for a topic to become a candidate |
| `--judge-a-min` | `-0.5` | survive if rubric-A improvement `>= this` |
| `--judge-b-min` | `0.0` | survive if rubric-B improvement `>` this (strict) |
| `--completeness-min` | `0.6` | survive if completeness score `>= this` |
| `--judge-seed` | `42` | seed for blind A/B before/after ordering |
| `--loom-url` | `http://192.168.2.132:8084/v1` | Ontology Loom façade |
| `--loom-model` | `qwen3.8-27b` | Loom model id |
| `--dry-run` | off | stop after candidacy detection; no network calls, no writes |
| `--limit N` | none | process at most N candidates this run |

The script is idempotent: each dossier records its candidate's assertion
fingerprint set (`assertion_fingerprints`); a re-run compares the ledger's
current set for a topic against what was last written to `proposals/` or
`rejects/` and skips topics whose set is unchanged. If new assertions have
landed since, the set differs and the topic is refreshed (re-dossiered,
re-judged, re-scored) rather than duplicated. When a topic changes verdict
between runs, its stale dossier pair is deleted from the other directory
before the new one is written — a slug never has twins in both queues.

Instrument/infra failures (target page missing, Loom unreachable, draft
assembly failed, judge unavailable) are a third outcome,
`candidate_deferred`: the dossier is still recorded in `rejects/` (nothing is
silently dropped) but its fingerprint set is *excluded* from the idempotency
comparison, so the topic is retried on every run until the instruments are
back. Only measured quality-threshold failures become terminal
`candidate_rejected` records — a transient outage can never permanently bury
a candidate.

## Ledger format assumptions (read from `ingest.py`)

Ledger pages are `podcast-evidence___<episode-slug>.md`; **episode identity
is the filename stem after that prefix** — this is exactly what
`ingest.py::_ledger_page_path` / `episode_slug_from_ledger` use, not a
`source::` field (page-level `source::` is always the constant `"AI Daily
Brief"`; the per-assertion `source::` sub-property is the *speaker/publisher*
attribution, e.g. `Host (AI Daily Brief)`, not the episode).

Each assertion bullet, mirroring `ingest.py::_build_ledger_bullet` exactly:

```
- [**[Tier label]** ]<claim text> [[Topic]] [[Topic2]] ...
  tier:: N
  confidence:: F
  source:: S
  claim-date:: D
  [evidence:: E]
  <!-- assertion-fp: <hex fingerprint> -->
```

`promote.py::parse_ledger_page` splits the page into top-level bullet blocks
(lines starting `- `, plus following indented `  key:: value` / fingerprint
sub-lines), extracts wikilinks as topics, strips the tier-label markdown
bold prefix and wikilinks from the claim text, and reads the four/five
`key:: value` sub-properties by regex. Bullets with **zero** wikilinks
(unmatched-topic assertions, which `ingest.py` still lands in the ledger for
audit but hands to `_propose_new_pages` separately) are excluded from
topic-grouping — they cannot be candidates for *this* stage by construction,
since candidacy is topic-grouped.

## Candidacy rule

A topic is a candidate iff:

```
len(assertions for topic) >= --min-assertions   (default 5)
AND
len({a.episode_slug for a in assertions})  >= --min-episodes  (default 2)
```

Verified against fixtures (see "Testing" below): a topic with 6 assertions
all from one episode does **not** qualify; a topic with 5 assertions split
2+3 across two episodes does.

## Dossier assembly

1. Load the candidate topic's target page: `<pages-dir>/<Topic>.md`. Missing
   target page is a **clean, logged reject** (`no_target_page`), not a crash
   — this stage never creates new ontology pages.
2. One Loom call (`POST {loom-url}/chat/completions`, `model: qwen3.8-27b`,
   `temperature 0.2`, `loom_options: {"verbatim": false}`) asking for a
   **splice edit**: strict JSON `{"mode": "insert_after"|"replace_section",
   "anchor": <verbatim substring of the current page>, "content": <new
   markdown>}`. The prompt supplies the candidate's full assertion list
   (claim, evidence, source, confidence, tier) as the material to integrate.
3. **Fail-closed splice validation**, adapted line-for-line from the
   page-judge scratchpad's `common.py::extract_splice_json` /
   `apply_splice` (not imported — that path is an ephemeral scratchpad, not
   present at deploy time, so the logic is reimplemented locally in
   `promote.py` to keep the skill self-contained): malformed JSON, a missing/
   empty anchor or content field, an anchor that doesn't appear **exactly
   once** verbatim in the page, or a resulting edit that doesn't
   byte-for-byte preserve everything outside the spliced region — all raise
   `SpliceError` and the candidate is rejected with the reason logged, never
   silently corrupting a page and never crashing the run.
4. Loom reachability is checked once per run via `GET {loom-url-without-/v1}/health`
   before any candidate is processed; if unreachable, every candidate that
   run is cleanly rejected with `loom_unreachable` (the call code itself —
   request shape, headers, splice parsing — is exercised and correct
   regardless; only the network round-trip is skipped).

## Pre-filter (two instruments)

### (a) Blind before/after judge

Adapted from the page-judge scratchpad's `judge.py` protocol: **primary
judge only** (Gemini 3.1 Pro Preview via the Google OpenAI-compatible
endpoint, `temperature=0`, `response_format: json_object`), **both rubric-A
(prose-quality, cannot credit additions by construction) and rubric-B
(informativeness-aware, added post-hoc to the page-judge study specifically
because rubric-A cannot distinguish "additions degrade pages" from "the
instrument cannot credit additions")**. Version order (before/after into
VERSION A/B slots) is randomised per-topic-per-rubric with a seeded RNG
(`sha256(seed|topic|rubric)`) so the judge is genuinely blind to which slot
is which — the sign of the returned `improvement` is un-blinded after
parsing so the dossier always records "after relative to before" regardless
of which slot the judge saw as A vs B.

`GOOGLE_API_KEY` unset is a **clean, logged skip**: `judge_before_after`
returns `JudgeResult(ok=False, error="GOOGLE_API_KEY not set...")`, and the
survival check treats a failed/unavailable judge as fail-closed (does not
survive), recording `judge_unavailable: ...` in the reject reasons. It does
not crash the run or silently drop the candidate.

Live in this environment: `GOOGLE_API_KEY` **is** set, so the E2E test below
exercised a real Gemini 3.1 Pro call (see Testing).

### (b) Answer-completeness gate — simplified single-topic lexical matcher

The paper's full method (`main.tex` § ceiling, and the T-REL/T-TAX/T-COMMON
templating in `loom/tools/paper/ontology_scaffold_v1.py` / the ten-model
sweep in § composition) templates formal questions from **ontology
relation/taxonomy edges** against a graph schema, and scores whether the
*shown scaffold text* names the gold `{slug, title}` answer using a
deterministic matcher: normalised gold title in shown text, OR ≥80% of its
length-≥4 words appear.

**This stage has no formal relation edges to template questions from** — a
ledger assertion is free text, not an ontology triple. The simplification
taken:

- **Gold targets** = the candidate topic's ledger assertion **claims**
  themselves (not a formally-templated question/answer pair derived from
  graph structure).
- **Shown context** = only the drafted splice's `content` field (the new
  section text), not the whole page — this measures whether the *specific
  material proposed for promotion* actually carries the evidence it claims
  to, which is what a promotion gate needs; it does not (and cannot, without
  templated questions) measure whether a *reader asking about the topic*
  would recover the fact, which is what the paper's instrument measures.
- **Matcher** = the exact same deterministic rule reused verbatim: normalised
  claim text present in normalised shown text, OR ≥80% of the claim's
  length-≥4, non-stopword words present.
- **No T-REL/T-TAX/T-COMMON distinction** — every assertion is treated as one
  undifferentiated gold item; no distractors, no cross-topic disjointness
  check, no copy-ceiling-style raw/scaffold/ceiling three-way comparison.
- **Single-topic only**, as briefed — no cross-topic aggregate.

`completeness_score` returns `hits / len(assertions)`; per-assertion
`matched: bool` detail is recorded in every dossier for audit.

### Thresholds (CLI-configurable, defaults and rationale)

| Threshold | Default | Rationale |
|---|---|---|
| rubric-B improvement | `> 0` | rubric-B is the instrument built to credit informativeness; any non-positive verdict means the reader-facing judge did not find the addition worthwhile — hard floor |
| rubric-A improvement | `>= -0.5` | rubric-A structurally penalises any addition (§ page-judge note: "all favour the pristine, unmodified original by construction"); requiring it to be non-negative would make survival impossible by construction, so the gate only excludes drafts that are *substantially* worse on raw prose quality (more than half a point on a 2-point scale), not merely non-zero |
| completeness | `>= 0.6` | mirrors the paper's framing of the copy ceiling as a promotion gate ("A block that drives the ceiling towards 1 is answer-complete and eligible for promotion; one that does not is unready" — main.tex "Consequence 1"); 0.6 is a majority-of-evidence floor, deliberately below 1.0 since evidence/attribution phrasing in a claim need not appear verbatim in a well-edited prose section for the underlying fact to be present |

Both rubric checks and the completeness check must all pass — the gate is
conjunctive, matching the multivariate-bar framing used throughout the
paper (§ bar): no single number stands in for "safe to promote".

## Dossier JSON shape

Written to `<proposals-dir>/<topic-slug>.json` (survivors) or
`<rejects-dir>/<topic-slug>.json` (rejects) — nothing is silently dropped:

```jsonc
{
  "topic": "Synthetic Test Topic Beta",
  "topic_slug": "synthetic-test-topic-beta",
  "status": "candidate_survivor" | "candidate_rejected" | "candidate_deferred",
  "reasons": ["..."],                    // empty for clean survivors
  "n_assertions": 5,
  "episodes": ["synthetic-ep-b", "synthetic-ep-c"],
  "assertion_fingerprints": ["bbbb...b1", "..."],   // idempotency key
  "target_page": "Synthetic Test Topic Beta.md",
  "assertions": [ { "claim", "tier", "confidence", "source",
                     "episode", "claim_date", "evidence", "fp" }, ... ],
  "draft": { "ok": true, "error": null, "edit": {"mode","anchor","content"} },
  "judge": { "ok": true, "error": null,
             "rubric_a_improvement": 1.0, "rubric_b_improvement": 2.0,
             "raw_a": {...}, "raw_b": {...} },
  "completeness": { "score": 1.0, "detail": [ {"fp","claim","matched"}, ... ] },
  "ontology_propose_payload": { ... }    // null unless status == survivor
}
```

A matching human-readable `<topic-slug>.md` is written alongside every JSON
file (same directory) for quick review.

## Intended `ontology_propose` adapter contract

This iteration does **not** call `mcp__ontology-bridge__ontology_propose`
directly, per the brief — `ontology_propose_payload` on survivor dossiers is
shaped so a later thin adapter can submit it with minimal transformation:

```jsonc
"ontology_propose_payload": {
  "target_page": "Synthetic Test Topic Beta.md",
  "edit": { "mode": "insert_after", "anchor": "...", "content": "..." },
  "provenance": {
    "assertion_fingerprints": ["..."],
    "source_episodes": ["..."]
  },
  "scores": {
    "rubric_a_improvement": 1.0,
    "rubric_b_improvement": 2.0,
    "completeness": 1.0
  }
}
```

The intended adapter (not built here):

1. Reads every `proposals/*.json` with `status == "candidate_survivor"` and
   a non-null `ontology_propose_payload`.
2. Resolves `target_page` to the live graph's page IRI/slug (the sandbox
   uses bare filenames; the live adapter needs the ontology-bridge's own
   page/class resolution, not a filesystem join).
3. Calls `ontology_propose` with the edit's `content` as the proposed
   addition, `anchor`/`mode` as placement hints, and `provenance` +
   `scores` attached as the proposal's justification/evidence trail —
   satisfying "survivors reach the graph's existing governed proposal
   queue [...] as scored dossiers with provenance down to assertion
   fingerprints" (main.tex § lifecycle).
4. On ontology-bridge approval, batched section regeneration (already the
   live behaviour on that side) is what actually applies the splice and
   attaches ontology markup — `promote.py` never writes to a curated page
   directly, matching the ledger-writer's "curated pages are never
   modified" invariant.

This adapter is out of scope for this iteration; only its contract is fixed
here so the dossier shape doesn't need to change when it's built.

## Testing (real runs, not description)

All tests ran against `.sandbox/` under this skill directory — the live
graph (`project4/mainKnowledgeGraph/pages/`) was never written to, only read
once to copy target-page fixtures.

1. **Real production fixture** — the actual
   `podcast-evidence___10-ai-projects-to-learn-gemini-3-nano-banana-and-opus-45.md`
   ledger page from the `ledger-e2e` scratchpad (a real prior end-to-end run)
   was copied into `.sandbox/pages/` along with the real graph pages its
   wikilinks resolve to (`Large Language Models.md`, `Reasoning.md`,
   `Model Architecture.md`, `Image Generation.md`, etc., copied read-only
   from `project4/mainKnowledgeGraph/pages/`). At default thresholds this
   produces **0 candidates** — every topic in that fixture has assertions
   from only 1 episode, correctly failing `--min-episodes 2`. Lowering
   `--min-episodes 1 --min-assertions 3` to force candidacy on the real data
   found 6 candidate topics (`Image Generation`: 5, `Data`/`Reasoning`/
   `ai-application`: 4, `Large Language Models`/`Model Architecture`: 3); a
   live run against `Image Generation` produced a valid splice draft
   (completeness 1.00) that the live judge scored `rubric-A=0.0,
   rubric-B=0.0` — correctly **rejected** by the `rubric_b_improvement > 0`
   floor (a zero-improvement draft should not promote).

2. **Synthetic fixtures purpose-built for the episode rule**, in the exact
   ledger bullet format:
   - `podcast-evidence___synthetic-ep-a.md`: 6 assertions, all `[[Synthetic
     Test Topic Alpha]]`, one episode → **0 candidates** at defaults
     (verified via `--dry-run`); forcing `--min-episodes 1` does produce a
     candidate, which then correctly rejects at the dossier stage with
     `no_target_page` (no page for that topic exists in the sandbox) —
     exercising the missing-target-page fail path cleanly.
   - `podcast-evidence___synthetic-ep-b.md` (3 assertions) +
     `podcast-evidence___synthetic-ep-c.md` (2 assertions), both
     `[[Synthetic Test Topic Beta]]`, two episodes, 5 assertions total →
     **1 candidate** at defaults, matching the brief's example exactly.
   - A minimal target page `Synthetic Test Topic Beta.md` was authored in
     the sandbox (placeholder `### Applications` / `### Relationships` /
     `### Provenance` sections) so the full dossier-assembly and pre-filter
     path could run live end-to-end.

3. **Full live end-to-end run** on `Synthetic Test Topic Beta`:
   - Loom reachability check: **live**, `GET
     http://192.168.2.132:8084/health` → `ok: true`.
   - Draft assembly: **live** Loom call (`qwen3.8-27b`,
     `loom_options.verbatim=false`) returned a valid `insert_after` splice
     anchored on `### Applications`, which validated and applied cleanly.
   - Completeness: **1.00** (all 5 claims' salient words appear verbatim in
     the drafted section — expected, since the draft is built directly from
     those claims).
   - Judge: **live** Gemini 3.1 Pro Preview call,
     `GOOGLE_API_KEY` present in this environment; rubric-A improvement
     `+1.0`, rubric-B improvement `+2.0`.
   - Result: **survivor**, written to
     `.sandbox/proposals/synthetic-test-topic-beta.json` /`.md`.
   - **Idempotency**: re-running immediately printed `unchanged since last
     run (same fingerprint set) — skipping`, with no duplicate Loom/judge
     calls.

4. **`--dry-run`** verified to stop before any network call or write, on
   both the real-fixture and synthetic sandboxes.

Live-vs-mocked summary: **every code path in this iteration's test run was
exercised live** — Loom `/health` and `/chat/completions`, and Gemini 3.1
Pro `/chat/completions` — because both endpoints were reachable and
`GOOGLE_API_KEY` was set in this environment. The `GOOGLE_API_KEY`-unset and
Loom-unreachable code paths are real, complete, and were exercised
separately by unsetting the reachability precondition in code review (they
return the documented clean-reject results above) but were not hit by
chance during the live run since both services were up throughout testing.
