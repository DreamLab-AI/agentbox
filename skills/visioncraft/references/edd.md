# Expectation-driven development

Use EDD when ordinary acceptance tests leave important intent unstated: ordering,
failure effects, interactions between users, resource limits or subjective
qualities. A requirement such as “helpful error messages” still needs an actual
human judgement; a schema cannot settle it. EDD complements DDD, TDD and BDD.

## Seven steps

1. **Formulate.** Describe one coherent behaviour, its boundaries and a
   counterexample. Clarify competing requirements before implementing them.
2. **Implement.** Make the change against those expectations and the governing
   specification. Start meaningful failing tests where a runnable seam exists.
3. **Produce evidence.** Run representative cases and preserve the invocation,
   observed output and exact subject. Do not substitute a narration of intent.
4. **Audit.** Have the required reviewer examine the raw evidence, source and
   scope, then attempt a counterexample the producer did not already cover.
5. **Challenge.** Resolve ambiguity, subjective acceptance and residual risk
   with the appropriate decision-maker. Prior agreement can supply acceptance;
   do not request the same permission again.
6. **Iterate.** Repair the implementation or expectation when evidence exposes a
   gap. Retain the earlier result and explain why the new claim differs.
7. **Stabilise.** Turn regression-critical scenarios into permanent checks and
   link the expectation to a successful execution of the resulting test.

Author, coder, evidence producer and auditor describe responsibilities. One
person can perform several for modest work. If project policy requires an
independent auditor, record the real execution identity and actual model family;
calling the same session “auditor” does not create independence. An unavailable
independent reviewer leaves that requirement incomplete. Same-family fallback
may provide advice, clearly labelled, without silently weakening the policy.

## Write a bounded expectation

Use [the template](../assets/expectation.md). Record an id, parent requirement,
linked decisions, priority, regression importance, evidence category and author
status. Describe the behaviour precisely enough that a reader can propose an
input that would falsify it. Include in-scope cases, excluded adjacent work and
explicit counterexamples. Do not make every assertion its own administrative
record or combine an entire product into one expectation.

For example, “discounts work” does not specify operation order. A useful
expectation says that a single percentage discount reduces the subtotal before
tax, names the rounding rule, handles an empty cart, and rejects stacking a
second code without changing the first. Shipping and currency conversion can
have separate expectations. Numbers here must come from the product contract,
not a generic quality template.

## Evidence categories

| Category | Retain | What it establishes |
|---|---|---|
| Executable | Command/argv, raw output, timestamp, full revision, relevant input snapshot, configuration, observed effect | Behaviour reached by that execution |
| Partially verifiable | Dry-run/plan/check output plus the same subject fields and an explicit limitation | The checked portion; a staging plan does not establish production behaviour |
| Manual/non-executable | Named observer, exact scenario, captured artefact, time, subject and unresolved conditions | An attributed observation under the project's acceptance policy |

UI and hardware work are not intrinsically non-executable: use available browser
or device tests when they measure the actual claim. Conversely, a simulation
does not prove the physical device. Classify by evidence available for this
claim, not by the technology's name.

For a defect reproduction, identify the reached failing assertion and preserve
a valid control in the same supported environment. A compiler error before the
scenario runs is setup evidence. A formatter panic before a replay assertion
does not prove replay. See [review evidence](review-evidence.md).

## Audit and counterexamples

Give the auditor the requirement, implementation revision, configuration and
raw observations. Ask them to find a mismatch, not to approve the producer's
story. A separately identified adversarial probe must exercise a plausible
boundary. Repeating the producer's input under another role label is not that
probe. A successful structural receipt check is useful to the auditor but does
not substitute for interpretation.

Keep unresolved disagreements scoped. Another model can propose a discriminating
experiment; majority agreement cannot establish the result. Escalate a required
decision through the project's existing authority rather than inventing a vote
or new approval mechanism.

## Freshness and regression coverage

Evidence belongs to a snapshot. Apply explicit freshness policy across three
separate questions: does the recorded revision resolve and have the required
ancestry; have relevant source/configuration/dependency bytes changed; has the
allowed observation age elapsed? Missing VCS information is unknown. An
unrelated commit need not invalidate evidence. The old thirty-day limit is a
possible project policy, not a universal default.

A `stabilized_by` reference is useful only if the named check exists, exercises
the expectation and has a matching successful receipt. Merely adding the string
cannot satisfy regression-critical work. If a real regression cannot yet run,
leave the required condition open or obtain an explicit risk decision under the
project's process; do not rename it stable.

Before treating expectation coverage as complete, check the scoped denominator,
linked observations, actual assertions/effects, required reviewer identity and
probe, freshness, and each required stabiliser. Keep author labels such as
`proven` separate from derived evidence status.

## Workshop and proportionality

For shared business logic, use [the workshop agenda](../assets/workshop.md):
agree domain words, draft examples independently, compare conflicts, and have
someone other than the author challenge each important expectation. For a
small repair, write the relevant expectation in the issue or test description
and use the local checks. This method does not mandate a workshop, agents or a
new database for every change.

EDD is an engineering workflow, not an established proof system. Subjective
criteria, incomplete runtime access and correlated reviewers limit confidence.
Choose the heavier audit loop where the consequences justify it; record which
parts were actually performed.
