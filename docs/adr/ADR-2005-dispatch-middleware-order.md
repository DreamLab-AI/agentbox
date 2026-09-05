---
id: ADR-2005
title: Every adapter dispatch is wrapped in a fixed order — observability, then privacy filter, then JSON-LD encoder
date: 2026-08-31
decision_status: superseded
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: [ADR-2036]
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A new cross-cutting concern proposed for the dispatch path, or any reordering of the three layers
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-005 (observability), ADR-008 (privacy filter routing), ADR-012 (jsonld federation grammar), DDD-004 §L08
---

# ADR-2005 — Every adapter dispatch is wrapped in a fixed order: observability → privacy filter → JSON-LD encoder

> **Superseded by [ADR-2036](ADR-2036-dispatch-two-layer-encoder-is-a-gated-surface.md) (2026-09-05).**
> The ordering requirement below — privacy redaction completes before encoding — still holds and is
> enforced at runtime. What this record got wrong is the *mechanism*: the dispatch wrap is two layers
> (observability around privacy), and JSON-LD encoding is a per-surface gated stage invoked by the
> owning route, which asserts the privacy marker rather than relying on positional composition.

## Context
Three cross-cutting concerns apply to every adapter method call: observability (span + log +
metrics), privacy redaction, and JSON-LD encoding for federation. Their order is not arbitrary —
if the JSON-LD encoder runs before redaction, unredacted fields can be serialised into a federated
representation and leave the box. Observability must span the full call including redaction latency.
Prior ADRs (005/008/012) each owned one layer but did not fix their composition order, leaving the
sequencing to be re-decided per call site.

## Decision
Every adapter method call passes through a fixed three-layer wrap, in order: observability (ADR-005)
→ privacy redaction (ADR-008) → JSON-LD encoding (ADR-012). Privacy redaction MUST complete before
the encoder runs (DDD-004 §L08). Any new cross-cutting concern adopts the same ordered shape, with
its fail-open vs fail-closed behaviour stated explicitly in an ADR. This forecloses encode-before-
redact, per-call-site ad-hoc ordering, and a cross-cutting concern that bypasses the wrap.

## Consequences
- Explicit encoder dispatch checks privacy traversal under the configured policy. The outer wrapper does not itself invoke encoding, and traversal does not guarantee redaction of every field or result.
- Observability latency includes redaction, so spans reflect the true dispatch cost.
- Cost: every non-lifecycle adapter method pays all three layers; new concerns must slot into the
  ordered chain rather than hook in arbitrarily.

## Verification
Historical verification recorded complete at cbe7335b9. The 2026-09-04 review below narrows that guarantee and changes implementation status to partial.
`management-api/observability/metrics.js:111-115` documents the layer order (1 observability, 2
privacy ADR-008, 3 JSON-LD ADR-012) and states redaction completes before the encoder (DDD-004 §L08);
`wrapDispatch` is defined from :125. `management-api/adapters/index.js:131` defines
`instrumentAdapter`, applied at :170 to wrap every non-lifecycle adapter method.

## Closeout extension — 2026-09-04

CP-03/04/08. Owner remains jjohare with adapter/runtime maintainers. The actual privacy wrapper recognises six write names and sanitises only the value argument. Synthetic strict-policy calls leave metadata/key text unchanged and skip createEpic; object values become returned strings. JSON-LD encoding is a separate caller action. Off/soft policy and per-slot order checks qualify the broad guarantee.

**Acceptance condition:** Specify mutation and sensitive-field coverage per method, preserve required argument/result types, and test strict/soft/off plus redactor failures across route, adapter and encoder. Distinguish a traversal marker from verified content redaction. Dependencies include effective configuration and failure receipts. Reopen on slot methods, lifecycle, privacy or encoding changes. See the [dispatch review](../../../../VisionFlow/docs/estate-review/adapter-dispatch.md) and [source/probe receipt](../../../../VisionFlow/docs/estate-review/evidence/dispatch-privacy-probe.json). No real sidecar, adapter persistence or startup fault injection ran.

## Acceptance progress — 2026-09-05

**Implemented.** `management-api/middleware/privacy-filter.js` now specifies and
enforces mutation and sensitive-field coverage instead of matching six names and
one argument.

- *Mutation coverage.* `isMutationMethod()` replaces the six-name `WRITE_OPS`
  set: an exact-name set plus a camelCase `<verb><Noun>` prefix rule, with read
  verbs enumerated so they can never be captured. `createEpic`, `storeSnapshot`,
  `publishDigest`, `updateBead` and `removeEpic` are mutations; `get*`, `list*`,
  `query*`, `search*`, `fetch*`, `read*`, `resolve*` and `health*` are not; and
  `created`/`adder` are not, because the prefix rule requires a camelCase
  boundary.
- *Field roles.* Every string leaf reachable in the arguments is given a role.
  **content** (`value`, `text`, `title`, `metadata`, `labels`, … and anything
  nested inside them) is redacted in place. **identifier** (`key`, `id`, `uri`,
  `urn`, `namespace`, …) is **screened and never rewritten**: rewriting a key
  would silently change what the record is addressed by and break every later
  read, so personal data found there rejects the write under `strict` and is
  counted under `soft` (`opf_identifier_pii_total`). Every other string is
  **unclassified** and screened the same way, so a new payload field cannot
  quietly become an exfiltration path because nobody added it to the table.
  The object-convention detector no longer requires a `value` property, so the
  `emit({type, data})` shape is filtered rather than misread as positional.
- *Type preservation.* Redacted leaves are written back through a copy-on-write
  setter that preserves array-ness and prototypes. An object `value` stays an
  object of the same shape, an array stays an array, a string stays a string,
  and the caller's own object is not mutated — previously an object `value`
  reached the adapter as a JSON string.
- *One round trip.* All fields travel in a single `/redact` call joined by a
  per-call 16-byte random delimiter; the response must split back into exactly
  the same number of segments or **nothing is applied** (typed
  `RedactionShapeError`, counted by `opf_redaction_shape_errors_total`). The
  existing contract test's "exactly one OPF call" assertion still holds.
- *Failure handling.* `strict` rejects and `soft` fails open **with the original
  payload** for: unreachable sidecar, HTTP 500, non-JSON body, a response with no
  `text` field, and a destroyed field delimiter. A cyclic or over-deep payload
  cannot be certified redacted and is rejected under `strict`. `off` and
  `OPF_MODE=off` make no call at all.
- *Traversal marker vs verified redaction.* A test asserts explicitly that the
  §L08 traversal marker is present on an `off`-policy payload whose content was
  **not** redacted — the marker is a traversal fact, never evidence of
  verified content redaction.

**Tests and results.** `tests/contract/privacy-coverage.contract.spec.js` (new)
— **29 passed, 0 failed**. The pre-existing
`tests/contract/privacy-filter.contract.spec.js` (6) and
`tests/contract/memory-encoder-bypass.contract.spec.js` still pass unchanged;
the three privacy/lifecycle specs together report **53 passed, 0 failed**.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2005-privacy-coverage.json`.

**Remaining.** A stub redactor only — the real `opf-router` was not run, no
adapter persisted anything, and JSON-LD encoding remains a separate caller
action, so per-slot order across route → adapter → encoder is still asserted at
the wrapper rather than end to end. The per-slot policy table in the live
`agentbox.toml` was not re-verified, and no failure receipt from a deployed
sidecar was captured.

**Governed paths changed.** `management-api/middleware/privacy-filter.js`,
`tests/contract/privacy-coverage.contract.spec.js` (new).
