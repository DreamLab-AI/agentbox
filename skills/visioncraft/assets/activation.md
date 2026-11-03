# Task brief for VisionCraft

Copy the relevant sections into an issue or request and replace the example
values with the actual task. This is a human-readable brief, not executable
configuration. Omit sections that do not help the assignment.

## Outcome and boundary

- Project, repository and supported stack:
- Requested behaviour and the user journey it serves:
- Current observed failure or missing capability:
- In scope and explicitly excluded adjacent work:
- Existing instruction, requirement, issue and decision references:
- Work owned by other people and isolation constraints:

## Expectations

Describe each coherent behaviour, boundaries, errors and a counterexample.
Mark regression-critical expectations. Use `assets/expectation.md` when a
separate record helps; an existing issue/test description is sufficient for a
small repair.

## Method and checks

Choose the useful entry mode: ordinary implementation, EDD, difficult debugging,
static-oracle reasoning, diagram diagnosis, review intake or Rust port.
Identify the supported positive control and the failing case. List required
checks, applicable feature/target matrix and the evidence each should establish.
Record optional checks and their limits rather than treating omissions as pass.

## Participants and authority

Identify the implementer, evidence producer, optional advisor and required
reviewer by actual capabilities. State any independence requirement. Sequential
work is valid when no delegation is needed. State existing authorisation for
external reviews, paid calls, deployment or other effects; do not infer it from
the skill name. No model or provider is required by this template.

## Evidence and completion

Choose the existing issue/register and private evidence location. Capture full
revisions, relevant dirty/untracked inputs, actual commands and output, time,
configuration, consumed dependencies and observed state. Keep source/test/
merge/publication/adoption/deployment separately evidenced. Name the final
acceptance condition and the bounded stopping point.

## Profile choices

- Prototype: keep supported-path correctness checks; explicitly state what
  production criteria are outside scope.
- Maintenance: focused regression/control plus applicable repository gates.
- Critical shared contract: expectations, consumer parity, required independent
  review, recovery/migration and release/consumer evidence as applicable.

Do not fill missing evidence with a profile label or a generic percentage.
