# Domain boundaries, decisions and tests

## DDD where the domain needs it

Identify the language users employ, the invariants that belong together, and
the systems that own them. A bounded context makes the meaning of a term
explicit; it is not automatically a service or repository. Draw a context map
where upstream/downstream ownership or translations can explain a defect.

Use entities for identity across change and value objects for validated values.
An aggregate should protect a small coherent set of invariants. Reference other
aggregates by identity rather than sharing mutable internal state. Domain
events make cross-context effects visible, but delivery, ordering and retry
guarantees still need an implementation and tests. A repository interface can
express persistence needs without requiring a generic framework.

Choose these patterns because they clarify the domain. A small CLI or local
repair does not need a full domain model, speculative factory or event bus.

## Decisions with an inspectable boundary

Create an ADR for a consequential tradeoff that would otherwise surprise a
maintainer. Record context, alternatives, chosen constraints, consequences,
status and the decision authority. Use the project's existing format and IDs;
[the template](../assets/adr.md) is available when none exists.

Relationships such as `depends_on`, `amends` and `supersedes` help readers follow
change. Validate that references resolve and statuses make sense. A consistent
decision graph still does not establish agreement with source code.

For records claiming implemented behaviour, identify the inspected full commit
and nonempty governed paths. A staleness check should detect changes to those
paths, dependencies or policies that could affect the claim. Verify the gate
actually selects records: an opt-in check with no opted-in paths protects
nothing. Staleness is a review queue, not a verdict that the decision is wrong.

Land the code before stamping its decision record. Compare governed paths with
the inspected revision; do not stamp the preceding commit while changing the
same implementation in the documentation commit. Proposed/rejected designs can
have no verified implementation revision. Record acceptance according
to existing project authority, including an already authorised decision.

When a path changes, distinguish cosmetic movement, semantic change and unknown
impact. Recheck the actual contract before refreshing the stamp. Reopen the
decision if behaviour or a tradeoff changed. An available independent review
can help with material drift; it does not replace the evidence or impose an
extra approval ceremony for every documentation update.

Optional graph/search tools can index these records. The Markdown or existing
decision store remains the chosen authority; VisionCraft does not create an
ADR database or assume an uninstalled plugin's commands work.

## TDD and BDD

Choose a behavioural seam. In the red phase, observe failure for the expected
reason with valid setup and a supported control. In green, implement the
smallest sufficient change. Refactor only while relevant tests remain green.
Use descriptive scenario names and arrange/act/assert structure where it helps.

Unit tests establish local rules; contract tests compare producer and consumer;
integration and end-to-end tests establish the journeys they actually reach.
Avoid tests that mirror a literal constant or an implementation branch without
testing meaningful behaviour. Keep failure effects and negative cases beside
valid success cases.

BDD scenarios can express shared examples; EDD records broader intent and
counterexamples before they become stable tests. Link regression-critical
expectations to executed checks as described in [EDD](edd.md). An isolated
source repair, a passing test and a deployed fix are separate facts.
