# Debugging from an observable failure

Start by finding a signal that distinguishes the reported defect from a healthy
case. Optimise it for speed, specificity and reproducibility before changing
several implementation paths. The object is to explain the failure, not merely
make an assertion green.

## Obtain a feedback loop

Use the first suitable seam: a unit/integration/end-to-end test; a request to a
development server; a CLI fixture with an expected snapshot; a browser action;
a captured trace replay; a temporary test program around the real function; a
property/fuzz loop; a regression bisector; a comparison between implementations;
or a structured manual action with an observable result.

Pin clocks, random seeds, filesystem state and dependencies where relevant.
For intermittent failures, measure the reproduction rate, preserve seeds and
stress the suspected boundary. Do not introduce sleeps as the product fix just
because a timing probe makes the problem disappear. For performance, capture a
baseline distribution or profile before bisecting; logs rarely locate a cost
regression by themselves.

If setup is temporarily blocked, record attempts and the exact missing input
or capability. Continue useful source tracing and fixture preparation, but mark
runtime conclusions unverified. Request only the access or observation actually
needed. Temporary environment failure is not permission to call a static review
a passed runtime check.

## Test a cause

1. Reproduce the user's failure at the intended layer. Read the earliest failed
   assertion, not only the final exit code.
2. Rank a few plausible causes, each paired with an observation that would
   distinguish it from the alternatives. Eliminate hypotheses already
   contradicted by the source or environment.
3. Change one variable in a probe. Prefer a debugger, boundary observation or
   targeted log over logging the entire system. Mark temporary probes so they
   can be removed completely.
4. After two attempts fail to change the same symptom, revisit the cause and
   consult an available independent perspective. Provide the failed attempts
   rather than asking another reviewer to repeat them.
5. Minimise the reproduction into a regression at the correct seam. Observe it
   failing for the product reason, repair the code, then rerun it, its supported
   control and the original scenario.
6. Remove temporary instrumentation and owned scratch files after retaining
   useful evidence. Explain the causal change and any remaining observation gap.

A pure-function test may be the right first seam. Claims about admission,
durable state or delivery also need the consuming boundary checked. For
stateful bugs, inspect effects even when the response reports an error.

## Static-oracle mode

Use this only when the task genuinely has no possible runtime: for example,
an offline implementation exercise supplied as text. It is a distinct evidence
category, not a workaround for a missing dependency on an otherwise executable
project. Do not claim compilation, test execution or a runtime PASS.

First reconstruct the contract from the available code. Read documentation,
the inverse function, sibling helpers, constants, exact error variants and test
assertions. Use the established names and types. An encoder paired with an
existing decoder should follow the decoder's field order and byte contract,
rather than an invented “equivalent” representation.

Then trace each assertion with substituted values. Record exact lengths,
prefixes, units, variants and fields. Follow one concrete value through both
directions of a roundtrip. Check every name exists, every branch returns the
declared type, borrowed/owned conversions match, and integer widths are valid.
“The roundtrip should work” is not a trace. State what remains unknowable
without compiling or running, and provide the first runtime checks for handoff.

For example, if a visible decoder expects `[version, length, payload...]`,
trace payload `[7, 8]` as `[1, 2, 7, 8]` only if the supplied constants define
version `1` and a one-byte length. Check empty input, maximum length and the
exact overflow error from that same visible contract. This illustrative trace
does not prescribe a new protocol.

## Broaden only when the evidence warrants it

When several modules or parallel implementations obscure the cause, use
[diagram diagnosis](diagram-diagnosis.md). For an ambiguous design, inspect
existing decisions and ask a focused question with the likely tradeoff. Do not
walk every possible design branch or require an ADR for a routine local choice.
An ADR is useful for a consequential, surprising decision with real alternatives.
