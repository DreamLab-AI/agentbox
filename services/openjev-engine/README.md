# openjev-engine

The **second** local typed-decision engine behind the Sovereign System One
façade (ADR-2094, SSO contract §11). It serves the same three routes, the same
request bodies and the same response shapes as
[`services/laya-engine`](../laya-engine/README.md) — one dialect, deliberately —
so the façade is indifferent to which engine is behind it and is repointed with
a single environment variable.

```
consumer ──► systemone:8097  system-one-facade (Rust)
                   ├──────►  127.0.0.1:8098    laya-engine     (systemone container)
                   └──────►  127.0.0.1:8099    openjev-engine  (this service, shared netns)
```

## Why a second engine

The first real eval of the laya engine (2026-09-20, 86 cases, 116 options)
returned **53.5% accuracy / 67.4% soft** against the ADR-2089 baseline of 90%
soft. Raising `head_max_len` from 256 to 768 made it *worse overall*
(47.7%/62.8%) while moving subgroups in opposite directions: near-neighbour
58→62, late-discriminator soft 68.8→81.2, and **`none` collapsed 35.7→7.1**.

The diagnosis is architectural, not a tuning miss: laya packs every option into
**one shared head budget**, so more candidate detail improves discrimination and
destroys the ability to decline. No value of `shortlist_k` escapes that, because
the options are competing for the same tokens *and* for the same probability
mass.

openjev is an NLI cross-encoder: it scores each option **in its own sequence**.
Three consequences follow, and they are the whole design:

1. **Rubrics are never compressed and never capped.** laya hard-truncates every
   option to 48 tokens before any budget logic; here there is no per-option cap
   to respect, so the façade must *skip* its compression step.
2. **Shortlisting becomes cost control, not correctness.** With no head budget,
   dropping options only saves time; it no longer protects the answer.
3. **`none` becomes a threshold rather than a competitor.** An independently
   scored option has an absolute entailment score, so "nothing here fits" is
   expressible. That threshold lives in the **façade**, not here — see below.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Load state, CUDA state, chunk reductions and the CPU fallback, as data. 200 while anything can answer, 503 when nothing can. |
| `GET /v1/models` | The real `max_len` and the §11.4 capability fields the façade drives itself off. |
| `POST /predict` | `{state, questions}` → `{answers, usage, ms, engine}`. |

`POST /predict` body:

```jsonc
{
  "model": "openjev",                   // optional; aliases incl. laya-* resolve to the default
  "state": {"user_request": "..."},     // string, object or list
  "max_len": 4096,                      // optional per-request sequence budget
  "truncate_left": false,               // keep the TAIL of the state instead of the head
  "noul_mode": "ent_vs_contra",         // optional; both readings are reported either way
  "questions": {
    "route":   {"type": "choice", "instructions": "...", "criteria": {"a": "rubric", "b": "rubric"}},
    "urgency": {"type": "score",  "instructions": "...", "criteria": ["low", "mid", "high"]},
    "tools":   {"type": "noul",   "instructions": "the user asked for a file edit"}
  }
}
```

Per question you may also override `hypothesis_template`, `option_format`,
`premise_template` and `truncate_left`.

## The primitive mapping (§11.2)

Premise and hypothesis are the model's only inputs; the three System One
primitives are built out of that one relation in
[`openjev_engine/primitives.py`](openjev_engine/primitives.py), which is pure
Python and separately tested.

| Primitive | Premise | Hypotheses | Answer |
|---|---|---|---|
| `choice` | `{instructions}\n\n{state}` | `The correct answer is: {key}: {rubric}` per option, **uncompressed, uncapped** | `probabilities` = entailment normalised across options; `choice` = argmax |
| `score` | `{instructions}\n\n{state}` | one per scale level | expected value over the normalised entailment distribution, index-scaled like laya |
| `noul` | `{state}` | the statement itself | `P(ent)`, or `P(ent)/(P(ent)+P(con))` |

Every hypothesis template is configurable, and the choice default is the model
card's own verified `rerank` phrasing — the wording the checkpoint was evaluated
with, not one invented here.

### `none` belongs to the façade

A choice answer carries an **absolute scale** alongside the normalised ranking:

```jsonc
{"type": "choice", "choice": "rust-engineer",
 "probabilities": {"rust-engineer": 0.31, "...": 0.0069},   // shares, sum to 1
 "scores":        {"rust-engineer": 0.62, "...": 0.014},    // raw P(entailment)
 "entailment_max": 0.62,
 "confidence": 0.62}
```

`scores` is the raw, un-normalised `P(entailment)` per option, straight off the
NLI head, one entry per option key. The `none_threshold` of §11.3 is applied by
the façade to those numbers, because an option's score must not depend on how
many rivals it had. That independence is the architectural claim of this engine,
and `test_the_absolute_scale_is_independent_of_how_many_rivals_an_option_had` is
it as a test: adding options moves `probabilities` and must never move `scores`.

**One key, one spelling.** The façade declares `scores` canonical and accepts
`entailment` / `raw_scores` as serde *aliases*, and an alias means "accept this
spelling **instead of** the canonical one" — not "both may appear". This engine
briefly emitted `scores` and `entailment` together, pointing at the same dict so
they could not drift; serde saw one logical field twice and rejected the whole
document with `duplicate field 'scores'`, failing every request. Identical
values were no protection, because the ambiguity is structural and a strict
reader is right to refuse it. The drift guarantee belongs inside the engine (one
dict, serialised once); aliases exist so a *reader* can accept several writers,
never so a writer can emit every spelling at once.

The threshold is not applied here, for two reasons:

* normalised probabilities cannot express "nothing here fits" — they sum to one
  however bad every option is, which is exactly the failure being fixed;
* the engine never sees the caller's original option set. The façade shortlists
  and re-expands, so the engine's denominator is the wrong one to decline
  against.

**Calibrate the threshold; do not assume 0.5.** Measured here on a real
128-option route, the *winning* option scored **0.172**, second place 0.056 and
`none` 0.017. The absolute scale is compressed by the
`"The correct answer is: {option}"` hypothesis template, so a 0.5 default would
decline every route and read as the engine failing rather than as a mis-set
constant.

If that boundary ever needs to move, it moves with a contract change, not by an
engine quietly deciding on the caller's behalf.

### Both noul readings, always

Neutral mass is a real confound: a state that simply does not mention the
statement lands in `neutral` and drags `P(ent)` down in a way that reads as
disagreement. So every `noul` answer reports **both** `noul_entailment` and
`noul_ent_vs_contra`, and `OPENJEV_NOUL_MODE` only decides which one is called
`noul`. Comparing them is then a query over eval output rather than a redeploy.

## What `/v1/models` tells the façade (§11.4)

```jsonc
{
  "scores_options_independently": true,  // ⇒ no shared head budget
  "option_max_len": null,                // ⇒ SKIP rubric compression
  "head_max_len": null,                  // ⇒ shortlisting is cost control, not correctness
  "max_len": 4096                        // ⇒ state windowing stays live for 25k compaction states
}
```

These are reported from what the engine actually does; a wrong value here
silently mis-drives the façade, which reads them at both the top level and
`data[0]` and distinguishes three cases per field: **absent** means "this engine
did not declare itself" and gets laya's conservative shape (head budget 192,
per-option cap 48, no decline threshold); **`null`** means "this limit genuinely
does not exist"; a number is honoured. Omission is therefore not neutral — it
would import laya's constraints into an engine that does not have them. Three
points are worth stating explicitly:

* `max_len` is **never null and never absent**. For the two caps the façade
  reads `null` as "no limit", but for `max_len` both null and absent fall back
  to 512, which would window a 4k-context engine as if it were a 512-token one.
  A misconfigured default model name therefore degrades to the real ceiling
  rather than to a silently wrong small number.

* `max_len` is the model card's 4k context and the vendored class's own ceiling.
  It is **not** `max_position_embeddings`, which is 262,144 — the backbone's
  claim, not a budget this checkpoint was trained to judge at. The real number
  is reported separately as `max_position_embeddings` for diagnosis only.
* `null` is the honest value for the two caps, not `0` and not a large integer.
  A façade that cannot parse `null` here will fall back to laya's 48-token cap
  and compress rubrics that never needed compressing — which would throw away
  the entire reason this engine exists.

## Supply chain: the pin, and why

`OpenJevCrossEncoder` lives in `modeling_openjev.py`, whose documented install
is "download it from the repository's default branch". The repository is four
days old and moving. That file is therefore **vendored at a pinned commit** in
[`vendor/`](vendor/PROVENANCE.md), digest-verified before import
(`VENDORED_MODELING_SHA256`), and the weights are fetched with `revision=` set
to the same commit. A spec with no revision is **refused at load** unless
`OPENJEV_ALLOW_UNPINNED=1`.

Worth being precise about the usual shorthand: the *weights* do **not** need
`trust_remote_code`. The checkpoint's `config.json` has no `auto_map` and names
`Qwen3_5ForSequenceClassification`, a class native to transformers 5. The remote
code hazard is the helper module alone, and vendoring is a stronger answer than
`trust_remote_code=True` with a `revision=` — the code is reviewable in
`git log -p` and cannot change without a commit here.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENJEV_MODELS` | `openjev=AlexWortega/openjev:qwen3.5-4b-nli-v2@4395b297…` | `name=repo[:subfolder][@revision]`; a local path is also accepted |
| `OPENJEV_DEFAULT_MODEL` | first entry | Model used when the request names none |
| `OPENJEV_DEVICE` | auto (`cuda` when available) | Placement |
| `OPENJEV_DTYPE` | `bfloat16` on CUDA, `float32` on CPU | The checkpoint is stored bf16 and both estate architectures have native bf16 |
| `OPENJEV_MAX_LEN` | 4096 | Sequence budget. Raising it leaves the trained context — a **measured** choice |
| `OPENJEV_HYP_CHUNK` | `32` | Hypotheses per forward pass; halves itself on CUDA OOM and reports it |
| `OPENJEV_BATCH_SIZE` | `8` | Pair batch for the one/two-hypothesis path |
| `OPENJEV_NOUL_MODE` | `entailment` | `entailment` or `ent_vs_contra` |
| `OPENJEV_CHOICE_HYPOTHESIS` / `_SCORE_` / `_NOUL_` | see table above | Hypothesis templates |
| `OPENJEV_OPTION_FORMAT` | `{key}: {rubric}` | How a key and rubric become one option string |
| `OPENJEV_CHOICE_PREMISE` / `_NOUL_PREMISE` | `{instructions}\n\n{state}` / `{state}` | Only `{state}` is ever truncated |
| `OPENJEV_BIND_HOST`, `OPENJEV_PORT` | `127.0.0.1`, `8099` | A non-loopback bind logs a warning; it is an ingress decision |
| `OPENJEV_MAX_QUESTIONS`, `OPENJEV_MAX_OPTIONS` | `64`, `512` | Request caps (413 above them) |
| `OPENJEV_ALLOW_UNPINNED` | `0` | Permit a model spec with no commit SHA |
| `OPENJEV_REQUEST_LOG` | `0` | Per-request log line and uvicorn access log |
| `HF_TOKEN` | unset | Not needed for this public repo; raises the anonymous rate limit |

## Operating it

The engine is opt-in behind a compose profile, so a plain `up` is the laya-only
stack unchanged.

```bash
cd /path/to/agentbox
C=docker-compose.system-one.yml

# laya only — the default, exactly as before
docker compose -f $C up -d

# both engines running, façade still on laya
docker compose -f $C --profile openjev up -d

# façade driven by openjev — PUT THIS IN .env, not on the command line:
#   SSO_ENGINE_URL=http://127.0.0.1:8099
#   SSO_MODEL=openjev
docker compose -f $C --profile openjev up -d

# openjev only: stop loading the laya checkpoints too (an empty model list is a
# degraded engine that still answers /health, not a crash) — `LAYA_MODELS=`
docker compose -f $C --profile openjev up -d

# probes (from inside the agentbox container the façade is systemone:8097)
docker exec openjev curl -s http://127.0.0.1:8099/health   | jq .
docker exec openjev curl -s http://127.0.0.1:8099/v1/models | jq '.data[0]'
curl -s http://systemone:8097/health | jq .
```

`--profile openjev down` stops it; the weights volume (`openjev-models`)
survives.

**Engine selection must live in `.env`.** A shell-level
`SSO_ENGINE_URL=… docker compose up -d` is *not* sticky: the next `compose up`
without it silently reverts the façade to laya, and `up -d openjev` on its own
is enough to recreate `systemone` and do exactly that. This is measured, not
theorised — it happened during bring-up here, and the only visible symptom was
`"model": "laya-typed-decisions"` reappearing in `/health`. An eval run after
such a revert would be an eval of laya wearing openjev's name.

**The second operational wart**, stated plainly: this container uses
`network_mode: service:systemone`, which is what lets the engine keep a
loopback-only bind while living in its own image. Its networking therefore dies
with the `systemone` container, so recreating that one means recreating this
one:

```bash
docker compose -f $C --profile openjev up -d --force-recreate
```

## Why it is a separate image

A hard dependency conflict, not a preference. `services/laya-engine` pins
`transformers==4.52.4`; this checkpoint declares `"model_type": "qwen3_5"` and
`"transformers_version": "5.15.0"`, and `Qwen3_5ForSequenceClassification` does
not exist before transformers 5. One interpreter cannot hold both. Both images
share the same `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime` base, so the
second image costs the pip layer and the code, not another torch — and sharing a
network namespace recovers the property the single container was giving us.

## Tests

Stdlib only — `unittest`, no pytest, no numpy, no torch — so they run anywhere,
including the agentbox container:

```bash
python -m unittest discover -s services/openjev-engine/tests -v   # 35 tests
```

`tests/test_concurrency.py` is a **live** probe and is skipped when no engine
answers, so the suite stays green on a laptop. Inside the container it is a real
test: it fires N simultaneous `/predict` calls released together off a
`threading.Barrier` and asserts every one succeeds and gets its OWN answer back.
It exists because a sequential test cannot reach the bug it guards (see
"Concurrency" below) — 35 passing unit tests did not, and an eval run paid for
it.

    docker exec openjev python -m unittest discover -s /opt/openjev/tests
    docker exec -e OPENJEV_TEST_CONCURRENCY=16 openjev python -m unittest \
        discover -s /opt/openjev/tests -p 'test_concurrency.py'

Two other tests are about the *document* rather than the numbers:
`test_the_absolute_scale_is_emitted_under_exactly_one_name` forbids any alias of
`scores` appearing beside it, and
`test_a_serialised_answer_survives_a_strict_duplicate_rejecting_parser` round-trips
the real JSON through an `object_pairs_hook` that refuses duplicate keys —
because `json.loads` silently keeps the last of two identical keys, which is
exactly why a Python-side equality check could not have caught the façade's
serde failure.

That constraint is deliberate. The module under test is where a wrong answer
would come from (which class index is entailment, whether a rubric survives
whole, what `none` needs in order to be decidable), and a test that needs a GPU
to run is a test that does not run. The GPU path is verified by live probes
against the running container.

## Notes that cost time to learn

* **The hypothesis must never be truncated.** The vendored encoder truncates
  from the *right* at `max_len`, so a long premise deletes the hypothesis and
  leaves the head judging a fragment — a confident wrong answer. The engine
  therefore budgets the sequence itself, trims only the **state** (from either
  end, per `truncate_left`), and refuses with a structured 422
  `question_unfittable` when even an empty state would not fit.
* **`allow_patterns` is subfolder-scoped, and must be.** The repository is
  ~87.6 GB across four checkpoints, per-task heads, training code and replay
  videos; we want one ~8.5 GiB subfolder. `huggingface_hub` matches with
  `fnmatch`, where `*` also matches `/`, so `*.json` is not the filter it looks
  like. Verify after a first boot with `docker exec openjev find /models -type f`.
* **The shared prefix is the cost argument, and it is measured, not asserted.**
  `predict_hypotheses` prefills the premise once per chunk and branches the KV
  and recurrent state across the batch. `usage.input_tokens` reports
  prefix + suffixes — what the engine really consumed — and each question also
  reports `sequence_tokens_naive` and `prefix_sharing_saved_tokens`, so the
  claim is checkable rather than folklore.
* **The chunk is a memory dial.** That branched cache scales with the chunk: at
  a 3k-token premise the full-attention layers alone are ~100 MB per branch. On
  a CUDA OOM the engine halves the chunk, keeps the reduction, and only falls
  back to CPU as a last resort — surfaced in `/health`, never merely printed.
* **A missing or broken checkpoint degrades `/health`; it never crash-loops.**
  The container exits only when the process it supervises dies.

## Concurrency: one request at a time, and why

`ModelHandle.lock` is an `RLock` held across the **whole** of a `predict` call —
planning, tokenisation and the forward pass — not just the matmul.

The reason is the fast tokeniser. It is Rust-backed and keeps its
truncation/padding state **on the shared object**: every `tok(...)` call routes
through `set_truncation_and_padding`, which takes a RefCell-style mutable
borrow. Two threads tokenising at once raise `RuntimeError: Already borrowed`,
and FastAPI runs sync endpoint bodies in a threadpool, so *any* concurrent
traffic reaches it. Locking only the forward pass was the original bug: `_plan`
tokenises outside it (hypothesis lengths, template cost, the state decode) and
so does the vendored `predict_hypotheses` internally.

It cost a full eval run — **1 of 86 routes answered, 43 `engine_error`, 42
`engine_unavailable`** — while `/health` stayed green the entire time, because
the container was perfectly healthy and only the requests were dying. That is
the diagnostic signature to remember: green health, mass request failure,
`Already borrowed` in the logs.

`encoder.max_len` is shared mutable state too (this engine sets it per request),
so the same lock is what stops one request being scored under a neighbour's
budget — asserted directly by
`test_every_concurrent_answer_is_complete_and_its_own`.

The cost is close to nothing: a 4B forward pass dominates by orders of magnitude
and was already serial. What changes is that the contention becomes **visible**
rather than racy — `engine.queue_ms` reports time spent waiting behind another
request, deliberately excluded from `ms` (it is not work this request caused),
because a hidden queue looks exactly like a slow model:

```
req 0 ms_precise=  501.5 queue_ms= 1883.8
req 4 ms_precise=  503.8 queue_ms=    0.0
```
