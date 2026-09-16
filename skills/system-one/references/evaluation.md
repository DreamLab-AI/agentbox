# Proving a judgment set works

**Typed output guarantees the interface, not the truth.** A response that parses
cleanly and a response that is right are unrelated properties, and the whole appeal of
this primitive — that your code can consume it without parsing — removes the crude
signal (malformed output) that usually tells you something is wrong. So the evaluation
step is not optional polish here; it is what replaces the thing you lost.

**Status: foundation. The harness under `../scripts/` is named but not built.**

## The fixture set

Before the first production call:

1. **Collect representative cases from real inputs**, not invented ones. Include the
   boring majority, the known edge cases, and at least a few where competent humans
   disagree — those are where a probability is doing actual work.
2. **Label the outcome you care about**, which is usually the *application behaviour*,
   not the judgment. "Was this ticket routed to the right team" beats "was the
   department Choice correct": the composition step is part of what you are testing,
   and a judgment set can be individually right and collectively useless.
3. **Hold some out.** Threshold tuning on the same set you report against is how you
   ship a number that does not survive contact with traffic.

## Calibrating thresholds

Thresholds come from your data and your consequences, never from a cookbook.

- Sweep the threshold over the fixture set and look at what each value costs *in the
  application*: how many false accepts, how many escalations, how much human time.
- Asymmetric consequences produce asymmetric thresholds. A missed serious violation
  and an unnecessary escalation are not the same size of mistake, and a single
  threshold that treats them as equal is a policy decision made by accident.
- Record the threshold, the date, the fixture set and the observed rates together. A
  threshold with no recorded provenance is a magic number within a month.
- Re-check after any change to the question wording, the state shape or the model
  version. All three move the distribution.

## Diagnosis

When a case comes out wrong, separate four failures before changing anything — they
have opposite fixes and get confused constantly:

| Failure | Symptom | Fix |
|---|---|---|
| **Missing evidence** | The answer could not have been derived from the state given | Fix the state, not the question |
| **Model error** | The evidence was present and sufficient; the judgment is wrong | Reword, split, or accept and threshold |
| **Code error** | The judgment was right; the composition produced the wrong behaviour | Fix the weights, the branch, the policy |
| **Service failure** | Timeout, rate limit, transport | Fix the fallback path, not the prompt |

The documented error codes (confirmed 2026-09-16) separate two of these cleanly and
should be handled distinctly rather than caught as one: `401` invalid key, `422` the
request body failed validation — a *code* error, and the body names the offending
field — `429` rate limit, `529` overloaded. The last two are the retry-with-backoff
path, and they are precisely the case that decides the fail-open/fail-closed question
for any always-on gate (`estate-integration.md` §3).

Inspecting this requires the exact state, the exact questions, the candidates offered,
the full distributions, the composition step and the observed outcome — all of them,
logged together. If that record is not kept, every failure looks like a model error
and the question set gets rewritten forever without improving.

Special case worth calling out: for source-value selection, **check candidate coverage
first**. A model that could not choose the right value because it was never offered
looks exactly like a model error and is a code error.

## Backend comparison — open

The comparison that has to happen before the local-fallback question in
`data-boundary.md` can be closed:

- The same fixture set, the same judgments, run against the cloud System One backend
  and against a constrained local model behind the Loom façade.
- Compare on decision accuracy **and** on whether the probabilities mean anything —
  calibration is the claimed differentiator, so it is the thing to measure, not
  accuracy alone. Bucket predictions by stated probability and check the observed
  frequency in each bucket.
- Record latency and cost per judgment for both.
- Vendor claims to verify while here: the batching saving, the latency figure, the
  token budget.

## What to log in production

Per call: the question set version, the state class (per `data-boundary.md`), the
answers with their full distributions, the composed decision, and the outcome once
known. That record is what makes thresholds re-tunable, what turns judgments into ML
features later, and what makes a regression attributable when the vendor ships a new
model version.
