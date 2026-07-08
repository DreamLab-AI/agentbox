# P2-REC-8 — Model diversity in orchestration (anti-fox cross-model verification)

**Item:** REC-8 (PRD-019 §REC-8, ADR-037 §D4, DDD-017)
**Wave:** P2
**Target tier:** `integrated`
**Canary:** `CANARY-AB-DIVERSITY` (correctness wire; fires when a closure-verification task dispatches to a different-family consultant than the producing family)
**Captured against SHA:** `ceb3401b915df070f193cc0ce6f54a18f96c9547` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T15:26Z

## Falsification statement (from PRD-019)

> REC-8 is falsified if verification dispatches to the same model family that
> produced the change, if it introduces a transparent-rewriting router ADR-011
> rejected, or if the producing family is not recorded against the verification.

## What changed

A thin wrapper over the ADR-011 named-consultant seam — config + selection
logic + tests, **not** a new service, **not** a cost-rewriting router (ADR-037
D4). The producer's model family is an input; the wrapper selects a NAMED
consultant from a different family; the dispatch records the producing family.

| File | Change |
|---|---|
| `mcp/consultants/shared/model-diversity.js` (new) | The wrapper. `FAMILY_BY_CONSULTANT` registry (codex→openai, antigravity→google, zai→zhipu, perplexity→perplexity, deepseek→deepseek) as config-as-code (no new `agentbox.toml` key, so no E016). `familyOf(nameOrModel)` resolves a producer's family from a consultant name, bare family token, or concrete model id (prefix + substring rules; Claude→anthropic, etc.). `selectVerifier({producerFamily,candidates,exclude,prefer})` returns a NAMED consultant whose family ≠ producer's, or **null** when none is available — never a same-family fallback. `verificationRecord(...)` stamps the producing family + `anti_fox_ok` verdict. |
| `mcp/consultants/shared/consultant-base.js` | Wired into the live consult seam: the `consult` tool gains an optional `producer_family`; when set, the consult is a closure verification and the envelope carries `verification` (producer family, this consultant's family, `anti_fox_ok`). A same-family self-verification is flagged (`anti_fox_ok:false` + stderr WARNING), never silent. `_emitConsultEvent` records the producing family + verdict on the agent-events dispatch record (metadata + the reserved string `verification` slot). |
| `tests/sovereign/model-diversity.test.js` (new) | 19 cases: `familyOf` resolution; **exhaustive** family-diverse selection (every consultant-as-producer and every family token → verifier family ≠ producer); no same-family fallback (null); `prefer` honoured only when diverse; `verificationRecord` verdict; and the consultant-base wire stamping the record. |

## How each falsification clause is met

1. **Same-family dispatch → falsified.** `selectVerifier` filters candidates to
   `familyOf(name) !== producerFamily`; the exhaustive test iterates every
   consultant-as-producer and every family token and asserts the verifier's
   family always differs. When only a same-family candidate remains it returns
   `null` (honest shortfall), tested — there is no same-family fallback path.
   Defence-in-depth: the consultant endpoint flags `anti_fox_ok:false` if asked
   to verify its own family.
2. **Transparent-rewriting router → falsified.** No router. Consultants stay the
   five ADR-011 named servers, explicitly invoked over the existing
   `consultant-base` envelope; the wrapper only answers "which named consultant".
3. **Producing family not recorded → falsified.** `verificationRecord` stamps
   `producer_family` + `verifier_family` + `anti_fox_ok` on the envelope, the
   JSONL audit log, and the agent-events dispatch record.

## Receipts

### 1. Syntax + seam integrity

```
$ node -c mcp/consultants/shared/model-diversity.js && echo OK
OK
$ node -c mcp/consultants/shared/consultant-base.js && echo OK
OK
$ (cd mcp/consultants && npm test)   # the ADR-011 seam still loads with the wire
all consultants load cleanly
npm test exit=0
```

### 2. Family-diverse selection — producer family X never verified by family X

```
$ cd management-api && npx jest tests/sovereign/model-diversity.test.js
PASS ../tests/sovereign/model-diversity.test.js
  model-diversity.selectVerifier — FALSIFICATION 1: producer family X is never verified by family X
    ✓ every consultant-as-producer selects a DIFFERENT-family verifier
    ✓ every known family token as producer selects a different-family verifier
    ✓ a producing model id (not just a token) is honoured — codex-produced change is not verified by codex
    ✓ an unknown producer family is diverse from every named consultant (any pick is valid)
  model-diversity.selectVerifier — FALSIFICATION 2: no same-family fallback
    ✓ returns null when the only candidate shares the producer family (honest shortfall)
    ✓ returns null when every candidate is excluded down to a same-family one
    ✓ excluded consultants are never selected
  ... (prefer honoured only when diverse; verificationRecord verdict; consultant-base wiring)
Tests:       19 passed, 19 total
```

### 3. Validator — no new manifest error (config-as-code, no new key)

```
$ node scripts/agentbox-config-validate.js 2>&1 | grep -cE '^E016'
3      # unchanged: the 3 pre-existing, out-of-scope keys (PRD-019 §Out of Scope)
$ node scripts/agentbox-config-validate.js 2>&1 | grep -E '^E[0-9]' | grep -vE 'ruvnet_brain|mcp_startup_timeout_ms|mcp_tool_timeout_ms'
(none — no new errors)
```

## Maturity label

`integrated` on the agentbox side: the anti-fox mechanism is built, wired into
the live consult seam, and available to verify the other items' closures
(meta-PRD Quality Gate 3). `CANARY-AB-DIVERSITY` fires when a real
closure-verification consult carries a `producer_family` and dispatches to a
different-family consultant in a live session.

---

## Gap-close correction — 2026-07-08 (adversarial re-verification)

**Captured against SHA:** `3bba1e3dfccba40a58b824a7447c0166e3aabc20` · **UTC:** 2026-07-08T17:00Z

**Defect found against the claim above:**

1. **Tier overclaim (canary-discipline breach).** The header and the Maturity
   label flatly claimed `integrated` with **no `CANARY-AB-DIVERSITY` fire and no
   LivenessHarness registration attempt** — a regression from this sprint's own
   honesty rule, which every sibling P0/P1 evidence file follows (P1-REC-6
   §"Maturity & canary honesty", P1-REC-5, P1-REC-3, P0-COM-14): a `CANARY-AB-*`
   that cannot be observed live in this build container is recorded
   **pending-live-session**, and the tier claimed is the one the offline receipts
   actually prove — `standalone` — not the live one. Under PRD-019's own Maturity
   Summary, REC-8 reaches `integrated` only when `CANARY-AB-DIVERSITY` fires on a
   **live** cross-model closure verification (a real closure consult carrying a
   `producer_family` and dispatching to a different-family named consultant). This
   container cannot make that observation.

**No code change.** The anti-fox wrapper (`model-diversity.js`), its wire into
`consultant-base.js`'s live consult seam, and the 19-case suite are unchanged and
still green — the mechanism is built and unit-proven **standalone**; only the
tier claim is corrected here (visibly, not by rewriting the header above).

**`CANARY-AB-DIVERSITY` — pending-live-session.** The live VisionClaw
`LivenessHarness` (`POST /api/canary/register`, port 4000) was not reachable from
this build container (`curl -m3 http://127.0.0.1:4000/api/canary/register` →
`http_code=000`, curl exit 7 / connection refused), so registration is recorded
**pending-live-session** per the honesty rule; the family-diverse selection +
verdict-stamping path is exercised green above. One-shot correctness wire (a
single live fire suffices, re-checked on its captured SHA).

**Corrected tier — was `integrated`, now `standalone` (code + test verified),
`integrated` PENDING the live fire:** the `FAMILY_BY_CONSULTANT` registry,
`selectVerifier` (never a same-family fallback → `null` on shortfall),
`verificationRecord`, and the `consultant-base` wire that stamps
`producer_family`/`verifier_family`/`anti_fox_ok` are all present and unit-proven
standalone. Under PRD-019's own Maturity Summary this does **not** reach
`integrated`, which requires `CANARY-AB-DIVERSITY` to fire on a live cross-model
closure verification — absent in this build container. The earlier `integrated`
claim is corrected here rather than deleted.

**Correction receipts:**
- `node -c mcp/consultants/shared/model-diversity.js` OK;
  `node -c mcp/consultants/shared/consultant-base.js` OK (both unchanged).
- `npx jest ../tests/sovereign/model-diversity.test.js` → PASS (19/19), re-run on
  the captured base.
- `node scripts/agentbox-config-validate.js` → exit 1 on **only** the three
  pre-existing `E016` keys PRD-019 scopes out (§Out of Scope: `ruvnet_brain`,
  `mcp_startup_timeout_ms`, `mcp_tool_timeout_ms`); no new error, no `diversity`
  error — drift-neutral (no `agentbox.toml`/schema change).
