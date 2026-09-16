# Composing judgments in code

The model supplies judgments. The workflow, the policy and the consequences stay in
code. This file is about the seam between them.

## Batch, don't serialise

**Every question that shares a state goes in one request.** They run in parallel;
adding a question costs its own tokens and barely any latency. The vendor reports an
order-of-magnitude saving in both cost and wall-clock for a batch of thirteen over
thirteen separate calls — confirm the shape of that on our own traffic, but design as
if it holds.

**Ask speculatively.** Include questions whose answers only matter on some branches,
and let the code decide which to consume. A ticket that turns out not to be a bug
report simply has its severity answer ignored. State each speculative premise
explicitly inside the question ("if this is a bug report, how severe…"), because the
question cannot see which branch was taken.

**A second request is the exception.** It is warranted only when code genuinely cannot
build the second request until the first answer arrives — when it must fetch further
evidence, assemble a state that did not exist, or choose the next question's options.
The vendor's own examples of a legitimate second round: rank a large candidate set,
then fetch the full text of the top few and judge those again; ask whether each line
break split a sentence, merge lines into blocks, then classify blocks that did not
exist before; use a Choice answer to select the next level's options in a hierarchy.
If the second request's questions could have been asked against the original state,
they should have been.

The ceiling on questions per request is the shared state+questions token budget, not
a question count.

## Patterns worth naming

- **Speculative fan-out** — every branch's questions in one call; code selects.
- **Composite scoring** — several Scores over one state, normalised and weighted in
  code. The weights are the policy and live in code, versioned and reviewable.
- **Cascade** — a cheap judgment gates an expensive one: a Noul decides whether the
  extraction questions are worth running, or whether a reasoning model is needed.
- **Rerank** — retrieve candidates by whatever is cheap, score relevance per candidate
  against the query, order in code.
- **Verify** — check one claim or field against its evidence; failures and uncertain
  cases escalate rather than being overwritten.

## Thresholds and uncertainty

- **Thresholds are calibrated on our data and our consequences.** A cookbook's numbers
  are an example to evaluate, never a default to inherit. `evaluation.md`.
- **`confidence` is distribution concentration, not correctness.** For Choice and
  Score it summarises how peaked the probability distribution is. It is not a
  statement about whether the workflow is right and not a permission to act.
- **Low confidence is not always a problem.** Several genuinely acceptable answers
  spread probability. For a harmless preference choice, a flat distribution is a
  correct description of the situation, not a failure.
- **A Noul near 0.5 is uncertainty, not a middling amount** of the thing.
- **Ignore uncertainty on branches you did not take.** A speculative answer's
  confidence is noise once its premise is false.

## Keep policy out of the judgments

Store the raw answers. Derive decisions from them.

- A weighted sum expresses *compensating* preferences — a strong dimension can offset
  a weak one. A rule like "any serious violation blocks, whatever else is true" is a
  separate condition, not a weight, and collapsing it into one is how a moderation
  system quietly starts allowing serious violations with otherwise good scores.
- Changing a weight, a threshold, a ranking or a display filter must not re-run
  inference. If it does, judgment and policy have been fused.
- Raw answers plus labelled outcomes become classical ML features later. That option
  only exists if the raw distributions were persisted, not just the decisions.

## Freshness

An answer describes the state it was given. Before applying a stored judgment to a
situation that has moved, check that the evidence still holds. Keep inferred state
(what the model judged) distinct from observed fact (what the system recorded) in
whatever you persist — conflating them is how a probability becomes a fact nobody can
trace back to its evidence.
