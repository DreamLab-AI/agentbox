# Contract test fixtures

This directory provides shared helpers for the five adapter contract suites.

## Files

| File | Purpose |
|---|---|
| `shared-assertions.js` | Behavioural-equivalence helpers used by every suite |
| `contract-versions.fixture.js` | Canonical semver versions + SLO table from ADR-005 |

## Philosophy

The fixtures test **shape and contract** — not internals.  Each helper receives
an adapter instance and checks:

1. **Method presence** (`assertMethodShape`) — every required method exists as a
   callable function.  Catches interface drift before any dispatch runs.

2. **Version honesty** (`assertContractVersion`) — the instance's
   `CONTRACT_VERSION` constant matches the canonical table here.  When a
   breaking change is made the constant here is bumped first; all
   implementation files fail CI until they are updated to match.

3. **Off-class discipline** (`assertOffClassThrows`) — every method on the
   `off` implementation raises `AdapterDisabled`, not a silent no-op and not an
   unrelated error.  Consumers rely on this to short-circuit gracefully.

## Promoting a pending test to green

When a real implementation exists:

1. Replace the placeholder import in the spec with the real impl import.
2. Remove the `todo` wrapper from the relevant `it` block.
3. Supply real fixtures/mocks for the method call.
4. The SLO numbers in `contract-versions.fixture.js` are the pass/fail thresholds
   for the performance assertions — do not relax them without an ADR amendment.
