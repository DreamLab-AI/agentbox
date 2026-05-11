# Expectation-Driven Development (EDD) Protocol

**Version:** 1.0.0 (introduced in build-with-quality v1.2.0)
**Status:** Required design-time methodology for all EDD-mode runs
**Companion of:** DDD (strategic), ADR (decisions), TDD (executable specs), BDD (Given/When/Then)

> EDD is the **conversation layer** between human intent and AI implementation.
> It does not replace TDD or BDD. It captures the requirements that don't fit
> in an `assert`, demands proof of fulfilment, and hands the proven examples
> off to TDD/BDD as the regression layer.
>
> This protocol exists because an agent can produce hundreds of lines per
> second; the human review budget can't keep up. EDD restructures the human's
> role from line-by-line reviewer to **adversarial editor of evidence**.

---

## 1. The Problem EDD Solves

| Layer | Captures | Misses |
|-------|----------|--------|
| TDD (`assert`) | Deterministic input → output | Qualitative ("helpful, not cryptic"), relational ("discount before tax"), systemic ("under high load") |
| BDD (Given/When/Then) | Structured behaviour scenarios | Anything that doesn't fit the three-line template; pre-test design exploration |
| Code review | Local correctness | Whether the spec was right in the first place |
| CI green | Regression | Whether the test was testing the right thing |

EDD targets the **specification gap**: requirements that live in the developer's
head until they show up as a bug. The agent can't read your head; it can read
plain-language expectations. EDD makes those expectations a first-class
artifact and demands the agent prove each one.

---

## 2. The Seven-Step EDD Loop

```text
┌─────────────────────────────────────────────────────────────────┐
│  EDD LOOP — runs BEFORE TDD red-green-refactor begins           │
└─────────────────────────────────────────────────────────────────┘

  1. FORMULATE      Human writes expectations in plain text
       │
       ▼
  2. IMPLEMENT      Agent (coder) implements against expectations + spec
       │
       ▼
  3. PRODUCE        Agent (evidence-producer) executes and captures real
                    inputs/outputs — execution receipts, not narration
       │
       ▼
  4. AUDIT          Different agent (evidence-auditor, distinct model)
                    independently verifies evidence against code
       │
       ▼
  5. CHALLENGE      Human reviews adversarially: "what input would break this?"
       │
       ▼ (if gaps)
  6. ITERATE        Tighten expectations, regenerate evidence, re-audit
       │
       ▼ (when satisfied)
  7. STABILIZE      Convert each shipped expectation into an automated
                    regression test (unit / integration / e2e). Archive
                    expectation + evidence + test reference as docs.
```

**Loop invariants:**

- Step 3 evidence MUST include the executed command and raw output. "I ran
  `npm test -- cart.test.ts` and got `PASS 12 tests`" beats "the cart works as
  expected".
- Step 4 auditor agent MUST be a different agent from Step 2/3 producer.
  Anti-fox separation is mandatory, not optional.
- Step 7 is non-skippable for any expectation tagged
  `regression_critical: true`. If you can't stabilize it, you can't ship it.

---

## 3. Writing an Expectation

An expectation is **one behaviour you'd explain in a single breath to a
colleague** — bigger than an `assert`, smaller than a feature.

### 3.1 Frontmatter

```yaml
---
id: EXP-042
parent_spec: SPEC-012        # Optional BHIL link
linked_adrs: [ADR-007]       # Optional decision links
priority: critical | high | medium | low
regression_critical: true    # If true, Step 7 stabilization is mandatory
evidence_category: executable | partially-verifiable | not-executable
status: draft | accepted | proven | stable | stale
authored_by: human | pair | swarm-spec-workshop
---
```

### 3.2 Body

```markdown
## Expectation: [Single-sentence behavioural claim]

[2–6 sentences describing the behaviour. Be specific about numbers,
boundaries, ordering, error modes. Mention what should NOT happen as
explicitly as what should.]

### In scope
- [Edge case 1 the expectation MUST cover]
- [Edge case 2]

### Out of scope (intentionally)
- [Adjacent concern that belongs in another expectation]

### Counter-examples (must NOT happen)
- [Behaviour that would falsify this expectation]
```

### 3.3 Specificity Rule

The freedom of natural language doesn't authorise vagueness — it authorises
**precision that formal syntax can't express**.

| ❌ Too vague | ✅ Precise |
|------------|-----------|
| "Handles large uploads efficiently." | "A 500MB upload completes within 30s and never holds the full file in memory; a 5GB upload uses streaming and peaks under 256MB RSS." |
| "Discount applied correctly." | "Discount is calculated on the pre-tax subtotal. Tax is applied to the post-discount amount. Two discount codes cannot stack — the second returns HTTP 409 with code `DISCOUNT_ALREADY_APPLIED`." |
| "Race condition handled." | "If two clients POST `/slots/123/book` within the same 100ms window, exactly one returns 201 with a confirmation token; the other returns 409 with `SLOT_TAKEN`. No timeouts, no double-bookings, no corrupted state — invariant must hold up to 1000 concurrent attempts." |

### 3.4 Sizing

- **Too big:** A page-long expectation bundling pricing + tax + shipping +
  refunds. Split it.
- **Too small:** A one-liner with no edge cases and no counter-examples.
  Expand it.
- **Right-sized:** Coherent concern (e.g. cart total math) + 2–4 edge cases
  + at least one explicit counter-example.

---

## 4. Evidence Categories

The `evidence_category` field on an expectation determines what proof the
producer must supply and how much confidence the auditor can grant.

### 4.1 Executable (gold standard)

Functions, APIs, scripts, queries that the producer agent can invoke
directly in its sandbox.

**Required evidence shape:**

```markdown
### Evidence for EXP-042

**Scenario 1: discount applied to subtotal, then tax**
- Command: `curl -X POST http://localhost:3000/cart/total -d @fixtures/cart-1.json`
- Raw response:
  ```json
  {"subtotal":45.00,"discount":-4.50,"taxable":40.50,"tax":3.24,"total":43.74}
  ```
- Verdict: ✅ matches expectation (tax applied to post-discount amount)

**Scenario 2: empty cart returns zero, not error**
- Command: `curl http://localhost:3000/cart/total -H "X-Cart-Id: empty"`
- Raw response: `{"total":0.00,"items":[]}` (HTTP 200)
- Verdict: ✅ matches expectation (zero, not 4xx)
```

### 4.2 Partially Verifiable

Infrastructure code, build configs, schema migrations. The agent can't
deploy to prod but can run dry-run / plan / validate against a test target.

**Required evidence shape:**
- The plan/dry-run command
- The plan/dry-run output
- An explicit confidence caveat: "Validated against staging; production
  behaviour inferred from plan output."

### 4.3 Not Executable

UI rendering, third-party integrations behind auth/rate limits, hardware
behaviour, manual interaction flows.

**Required evidence shape:**
- Producer must mark evidence as `confidence: low` and `requires_human_verify: true`
- Auditor must NOT pass-stamp these without human spot-check
- Stabilization step (Step 7) carries extra weight — the regression test
  often becomes a synthetic / contract test, not a true e2e test

> **Honesty rule:** If a project's expectations are mostly category 3, EDD's
> value degrades. Invest more in stabilization, less in evidence-loop
> ceremony, and lower your confidence accordingly.

---

## 5. The Anti-Fox Protocol

> "The student who takes the exam should not grade it."

The same agent that wrote the implementation has structural incentive to
generate evidence that confirms it. Three required mitigations:

### 5.1 Separation of Roles

| Role | Agent type | Must be different from |
|------|-----------|------------------------|
| `expectation-author` | Human (or swarm spec workshop) | — |
| `coder` | implementation agent | producer & auditor |
| `evidence-producer` | execution agent (tool-use enabled) | auditor |
| `evidence-auditor` | verification agent, **different model** | producer |

The auditor MUST run on a different model family from the producer (e.g.
producer = Sonnet, auditor = Opus or Haiku, or vice versa). Same-model
audit is forbidden — it inherits the same blind spots.

### 5.2 Execution Receipts

The producer's evidence is rejected by the auditor if any scenario is
missing:
- The exact command/invocation that was run
- The raw, unsummarised output
- The timestamp of execution
- The git SHA of the code under test

Narrative evidence ("I tested it and it works") is auto-rejected.

### 5.3 Adversarial Probes

The auditor MUST run at least one scenario the producer did not run. The
auditor's mandate is to **find a counter-example**, not to confirm. If the
auditor cannot find a counter-example after honest effort, that is the
evidence the human reviews.

---

## 6. Versioning and Decay

Evidence is a **snapshot**, not a safety net. It rots when code changes.

### 6.1 Evidence Staleness

An expectation with attached evidence is `stale` when:
- The git SHA in the evidence no longer exists on the current branch, OR
- Any file referenced in the evidence has been modified since the SHA, OR
- More than 30 days have elapsed since the last evidence run

Stale evidence MUST be re-produced before the expectation can re-pass the
Evidence Coverage gate.

### 6.2 Why Stabilization (Step 7) is Non-Negotiable

Automated tests fail loudly when code breaks. EDD evidence goes silently
stale. Therefore:

- Every `regression_critical: true` expectation MUST have a `stabilized_by`
  field pointing at the test ID (e.g. `tests/cart/total.test.ts::discount_before_tax`)
- The Evidence Coverage gate fails if any `regression_critical` expectation
  is missing a `stabilized_by` reference
- Stabilization tests are the regression alarm; expectations are the
  design-time conversation. Both layers required.

---

## 7. Workshopping Expectations

EDD as solo workflow concentrates a single-point-of-failure in one author's
mental model. For features touching shared business logic, use the
**workshop pattern**:

1. Spec workshop (15–30min) — multiple humans (or one human + multiple
   agents in adversarial-debate topology) draft expectations together
2. Each expectation is reviewed by at least one author who didn't write it
3. Conflicting expectations are surfaced and resolved BEFORE handoff to
   coder agent — silent contradictions are worse than no spec

For solo work or low-stakes features, skip the workshop but keep the
auditor agent (Step 4). The auditor partially substitutes for a second
human.

---

## 8. Quality Gate: Evidence Coverage

Adds a sixth gate to the existing build-with-quality stack.

| Check | Threshold | Required |
|-------|-----------|----------|
| Every shipped feature has ≥1 expectation | 100% | Y |
| Every expectation has executed evidence | 100% | Y |
| Evidence has execution receipts (cmd + raw output + SHA) | 100% | Y |
| Auditor verdict recorded by different agent | 100% | Y |
| `regression_critical` expectations have `stabilized_by` | 100% | Y |
| Stale evidence (>30d or post-SHA-drift) | 0 entries | Y |
| Counter-example coverage (auditor probe per expectation) | ≥1 | Y |

Gate failure modes:
- Missing receipts → return to producer (Step 3)
- Auditor finds counter-example → return to coder (Step 2)
- Missing stabilization → return to TDD agent (Step 7)
- Stale evidence → re-run Step 3 against current SHA

---

## 9. Where EDD Sits in the Phase Workflow

```
Phase 0: Discovery (DDD strategic) ─── unchanged
       │
Phase 1: Expectation Authoring (NEW)
       │   • expectation-author agent + human
       │   • produces EXP-NNN artifacts with frontmatter
       │   • acceptance: human signs off on expectations as draft → accepted
       │
Phase 2: Technical Design (DDD tactical + ADR) ─── unchanged
       │
Phase 3: Implementation (TDD red-green-refactor) ─── unchanged
       │   • coder agent uses EXP-NNN as input alongside SPEC/ADR
       │
Phase 4: Evidence Production & Audit (NEW)
       │   • evidence-producer executes scenarios per expectation
       │   • evidence-auditor (different model) verifies + adversarial probe
       │   • human reviews adversarially, may add expectations → loop to Phase 3
       │
Phase 5: Quality Gates (existing) + Evidence Coverage (NEW)
       │
Phase 6: Stabilization (NEW)
       │   • tdd-stabilizer agent converts proven expectations into
       │     regression tests, links them to EXP-NNN via stabilized_by
       │
Phase 7: Deployment (existing)
       │
Phase 8: Learning (existing)
           • ReasoningBank stores expectation patterns as well as code patterns
           • Cross-project transfer of high-quality expectation libraries
```

---

## 10. Honest Limits (read this)

EDD is a **proposed framework with an opinionated implementation**, not a
battle-tested standard. Known weaknesses:

1. **Subjective expectations ("helpful error messages") still need human
   judgement.** The auditor agent will tend to grade subjective qualities
   favourably. Don't outsource taste — keep the human in Step 5 for these.

2. **Evidence is non-deterministic when re-generated.** Two LLM-produced
   evidence runs against the same code may differ in the scenarios chosen.
   This is why Step 7 (stabilization to deterministic tests) is mandatory.

3. **Category-3 expectations (not executable) get weaker confidence.**
   Don't pretend otherwise. If a feature is dominated by such expectations
   (e.g. pure UI polish), EDD reduces to "structured discussion" rather
   than "verified specification". That's still useful, but mark it.

4. **Workshop overhead.** Collaboratively authored expectations cost more
   than one developer typing in a hurry. Pay the cost on critical paths
   only.

5. **Token budget.** Evidence runs + audit runs cost tokens. The 75% token
   reduction target from TinyDancer routing helps, but EDD is not free.
   Reserve full EDD discipline for `priority: critical | high`
   expectations; use lighter-touch evidence (one scenario, no auditor) for
   medium/low.

---

## 11. Quick-Reference Templates

### Expectation file (`.claude/expectations/EXP-042.md`)

```markdown
---
id: EXP-042
parent_spec: SPEC-012
linked_adrs: [ADR-007]
priority: critical
regression_critical: true
evidence_category: executable
status: draft
authored_by: human
---

## Expectation: Cart total ordering — discount before tax

When a cart contains multiple items, the order of operations for total
calculation MUST be: subtotal → apply discount on pre-tax subtotal →
apply tax on post-discount amount → return total. An empty cart returns
`{"total": 0.00}` with HTTP 200, not an error.

### In scope
- Multiple items, varying quantities
- Single discount code (no stacking)
- Empty cart edge case
- Pre-tax discount calculation

### Out of scope (intentionally)
- Multiple discount stacking (covered by EXP-043)
- Currency conversion (covered by EXP-044)
- Shipping calculation (covered by EXP-051)

### Counter-examples (must NOT happen)
- Discount calculated on individual line items instead of subtotal
- Tax calculated on pre-discount amount
- Empty cart returning HTTP 4xx or throwing
- Total rounded inconsistently with line items
```

### Evidence file (`.claude/evidence/EXP-042.evidence.md`)

```markdown
---
expectation_id: EXP-042
git_sha: 3f9a2c1
produced_by: agent:claude-sonnet-4-6
produced_at: 2026-05-03T14:22:11Z
audited_by: agent:claude-opus-4-7   # MUST differ from produced_by
audited_at: 2026-05-03T14:24:08Z
auditor_verdict: pass
auditor_counter_examples_attempted: 3
auditor_counter_examples_found: 0
stabilized_by: tests/cart/total.test.ts::discount_then_tax
---

## Scenario 1: standard cart with discount

**Command:**
\`\`\`
curl -sX POST http://localhost:3000/cart/total \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"sku":"WIDGET","qty":2,"price":10},{"sku":"GADGET","qty":1,"price":25}],"discount":"SAVE10"}'
\`\`\`

**Raw response (HTTP 200):**
\`\`\`json
{"subtotal":45.00,"discount":-4.50,"taxable":40.50,"tax":3.24,"total":43.74}
\`\`\`

**Verdict:** ✅ Discount (4.50) is 10% of subtotal (45.00). Tax (3.24) is 8% of taxable (40.50). Order matches expectation.

## Scenario 2: empty cart

**Command:** `curl -s http://localhost:3000/cart/total -H "X-Cart-Id: empty-cart-7"`

**Raw response (HTTP 200):** `{"total":0.00,"items":[]}`

**Verdict:** ✅ Zero, not error.

## Auditor adversarial probe (Scenario 3 — not run by producer)

**Command:** `curl -sX POST http://localhost:3000/cart/total -d '{"items":[{"sku":"X","qty":1,"price":0.01}],"discount":"SAVE10"}'`

**Raw response (HTTP 200):** `{"subtotal":0.01,"discount":0.00,"taxable":0.01,"tax":0.00,"total":0.01}`

**Verdict:** ✅ Rounding behaviour consistent at 2dp; discount of 10% of 0.01 rounds to 0.00 (not 0.001), no negative-tax bug.
```

---

## 12. References

- Adzic, G. *Specification by Example* (2011) — collaborative example-driven specification
- Cunningham, W. FIT/FitNesse — natural-language acceptance tables
- Meyer, B. *Eiffel: The Language* — Design by Contract preconditions/postconditions
- Property-based testing — QuickCheck and successors

EDD's novelty is **execution context**: the LLM is the glue code that was
previously hand-written for Specification by Example, and the verification
loop is conversational rather than binary pass/fail. The intellectual
lineage is otherwise old, and the older work remains worth reading.
