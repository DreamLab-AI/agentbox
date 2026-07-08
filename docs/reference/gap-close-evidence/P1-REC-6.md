# P1-REC-6 — Authority model (recoverable vs zero-tolerance, escalation by default, block on signed response)

**Item:** REC-6 (PRD-019, ADR-037 D2, DDD-017 §AuthorityClass / §8 `AuthorityGate`)
**Wave:** P1
**Target tier:** `integrated`
**Canary:** `CANARY-AB-AUTH`
**Captured against SHA:** `d13f8688f5dc5cb39c4081f416ef4457e7738af5` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T12:44:16Z

## Falsification statement (from PRD-019)

> REC-6 is falsified if a new skill defaults to permissive, if a zero-tolerance action
> proceeds without a signed-response wait, or if agentbox reimplements the 31402
> signing/decision loop instead of consuming the forum's.

## What changed

| File | Change |
|---|---|
| `management-api/lib/authority.js` | **New.** The `authority_class` axis (`recoverable` \| `zero-tolerance`), ORTHOGONAL to `lib/mandate.js` WAC modes. `classifyAction()` resolves per-skill frontmatter override → config table → **escalation-required** (never permissive). `buildAuthorityGate().guard()`: a recoverable action proceeds with no wait; a zero-tolerance/escalation action **publishes a kind-31402 ActionRequest** (via `lib/agent-control-surface`) and **blocks until a verified, approving, signed kind-31403 ActionResponse** arrives (fail-closed on timeout/unavailable/reject/unverified). It consumes the forum's signed decision — it never builds a 31403 or makes the decision itself (ADR-037 D2). |
| `agentbox.toml` | New `[skills.authority]` block: `enabled`, `default = "escalation"`, and `[skills.authority.classes]` — the classification TABLE (16 action classes: 8 zero-tolerance irreversible/high-blast-radius, 8 recoverable read/reversible/sandboxed). Classification is declarative config, not hardcoded. |
| `schema/agentbox.toml.schema.json` | Adds the `skills.authority` sub-schema: `enabled` (bool), `default` (enum `["escalation"]`), `classes` (map → enum `["recoverable","zero-tolerance"]`). Enforces the two valid classes at validate time. |
| `skills/web-researcher/SKILL.md` | Frontmatter `authority_class: recoverable` (read-only research). |
| `skills/github-multi-repo/SKILL.md` | Frontmatter `authority_class: zero-tolerance` (org-wide cross-repo pushes, not locally reversible) — demonstrates the per-skill override the gate honours. |
| `tests/sovereign/authority.test.js` | **New.** 12 cases locking all three falsification clauses. |

## Receipts

### 1. Syntax checks (`node -c`) + config parse — 2026-07-08T12:41Z

```
OK: management-api/lib/authority.js
OK: tests/sovereign/authority.test.js
OK toml; skills.authority.classes = {ontology_axiom_load:"zero-tolerance", ... , docs_render:"recoverable"}  (16 entries)
```

### 2. Validator green (drift-neutral) — `node scripts/agentbox-config-validate.js`

`[skills.authority]` validates clean. The validator exits 1 ONLY on the three
pre-existing `E016` keys the PRD scopes out (§Out of Scope, line 220: `ruvnet_brain`,
`mcp_startup_timeout_ms`, `mcp_tool_timeout_ms`). Proven drift-neutral against the HEAD baseline:

```
BASELINE (HEAD agentbox.toml, current schema): 3 errors  (ruvnet_brain, 2× email_search timeouts)
CURRENT  (+ [skills.authority]):               3 errors  (identical)
errors mentioning 'authority':                 NONE — [skills.authority] validates clean
```

My schema addition introduces zero new errors, and the new block is accepted by AJV
`additionalProperties`.

### 3. Unit test — the authority gate (jest, management-api runner)

```
$ cd management-api && npx jest tests/sovereign/authority.test.js
PASS ../tests/sovereign/authority.test.js
```

Cases proving the three falsification clauses:
- **Clause 1 (defaults):** an unclassified action class → `escalation-required`, NOT permissive; a malformed table value also escalates. SKILL.md frontmatter override wins over the table.
- **Clause 2 (block-on-signed-response):** a recoverable action proceeds with `blocked:false` and NEVER calls the decision consumer. A zero-tolerance action publishes a **kind-31402** request and `blocked:true`, releasing (`allow`) ONLY on a verified `approve` 31403. It DENIES (fail-closed) when: no decision surface is wired (`no-decision-surface`), the response times out / is absent (`no-signed-response`), the outcome is `reject`, or the signature does not verify (`unverified-signature`). An unclassified action escalates through the same block-on-signed-response path.
- **Clause 3 (consume, not reimplement):** the only event the gate builds is the 31402 ActionRequest (asserted `published[0].kind === 31402`); the module exposes no `buildActionResponse`/`signDecision` surface. `ACTION_REQUEST_KIND===31402`, `ACTION_RESPONSE_KIND===31403` come from the single ACSP registry in `mcp/servers/nostr-bridge.js`.

### 4. Orthogonality (DDD-017 invariant 8) & no regression

`authority_class` is a separate axis from `mandate.js` `ALLOWED_MODES` — the gate never reads
or writes WAC modes. Adjacent suites (mandate, agent-control-surface, elevation-publisher) unchanged:

```
$ npx jest tests/sovereign/{agent-control-surface,elevation-publisher,agent-mandate}.test.js  → all pass
```

## Maturity & canary honesty

- **Tier claimed:** `integrated` — the axis, the config classification table, escalation-by-default, and the block/release-on-signed-31403 gate are all wired and unit-proven. The gate consumes the ACSP contract via injected `publishActionRequest`/`awaitDecision` (production wires the already-connected `NostrBridge`, mirroring `lib/elevation-publisher`); the ACSP 31400–31405 signing/decision loop stays owned by nostr-rust-forum (COM-16).
- **`CANARY-AB-AUTH`:** registered as the code that fires when a zero-tolerance action blocks, awaits a signed 31402/31403 response, and releases on receipt in a live session. The live VisionClaw `LivenessHarness` (`POST /api/canary/register`, port 4000) was not reachable from this build container, so registration is recorded as **pending-live-session** per the honesty rule; the block/release path is exercised green above. It is a one-shot correctness wire (a single live fire suffices, re-checked on its captured SHA).
