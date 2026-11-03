# Expectation worksheet

This is a documentation template, not a VisionCraft JSON schema. Reuse existing
project IDs and statuses. An author status records intent; it does not establish
that checks ran.

| Field | Record |
|---|---|
| ID and parent requirement | Stable existing reference |
| Related decisions/work items | Resolvable IDs, paths or URLs |
| Behaviour | One coherent externally observable claim |
| Priority and regression importance | Why its consequences justify the selected checks |
| Evidence category | Executable, partially verifiable or attributed manual observation |
| Author/status | Actual author and project status |
| In scope | Boundaries, order, errors and supported cases |
| Out of scope | Adjacent work excluded intentionally |
| Counterexample | An input/effect that would falsify the claim |
| Evidence references | Exact subject, commands/observations and raw artefacts |
| Required audit | Real reviewer/probe and independence evidence, if applicable |
| Stabiliser | Named meaningful check plus successful execution, when required |
| Freshness | Relevant inputs, ancestry/age policy and unresolved gaps |

## Filled design example: cart operation order

This example contract computes subtotal, applies one discount, then taxes the
discounted amount. It defines rounding at each currency boundary. An empty cart
returns zero. Multiple-code stacking and currency conversion are separately
specified. Counterexamples include taxing the original subtotal, losing cents
through binary floating-point conversion, and altering a cart after rejecting a
second code.

For a subtotal of 45.00, a 10% discount and 8% tax, the expected intermediate
values are 4.50 discount, 40.50 taxable and 3.24 tax, yielding 43.74. These are
expected values for a future executed check, not a fabricated API response.
Its valid control, empty-cart case and rounding boundary need real receipts.
