---
id: ADR-2106
title: Ontology proposals and decisions both go through vault — propose raises them, a guarded vault edit applies them
date: 2026-09-22
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 416a60a437f314b4a6169a61798ba6e0379d816b
verified_paths: [management-api/lib/ontology-apply.js, management-api/lib/ontology-propose.js, management-api/lib/kg-proposal-extractor.js, management-api/lib/elevation-publisher.js, management-api/routes/kg-elevation.js, management-api/adapters/orchestrator/local-process-manager.js, management-api/tests/ontology-apply.test.js, management-api/tests/ontology-propose-vault.test.js]
owner: jjohare
review_trigger: the `vault` binary landing on PATH (VisionClaw WS-C), or Loom deploying `/loom/attest` (WS-H)
repo: agentbox
---

# ADR-2106 — Ontology proposals and decisions both go through `vault`

## Context

agentbox sat on **both ends** of the ontology governance loop and neither end was wired to it.

At the *proposal* end, `lib/ontology-propose.js` built a `POST /api/ontology-agent/propose` request descriptor for the KG-elevation scan. Nothing in agentbox ever executed it — which made it worse, not better: the descriptor was *handed out*, returned in the route's response and baked into `fields.propose_request` of a **signed, durable** kind-31402. VisionClaw ADR-2116 retires that route, so left alone agentbox would have gone on publishing an instruction to call a 410 into events nobody can edit.

At the *decision* end, `handleGovernanceDecision()` relayed every kind-31403 to a matched agent's stdin or persisted it to the pod, and did nothing else. Forum [ADR-2013](https://github.com/DreamLab-AI/nostr-rust-forum) now emits two outcomes that *mean* a corpus write — `Promote{iri}` and `Demote{iri}` — and VisionFlow `PRD-sovereign-corpus` §3.3 names agentbox as the mutation owner: relay → `handleGovernanceDecision` → `vault edit` → Loom `AttestationLedger`. The `vault` binary is VisionClaw WS-C's and does not exist yet. The handler also read the outcome from `parsed.outcome`, while a real forum 31403's content is the internally-tagged `DecisionOutcome` JSON keyed `action`.

## Decision

1. **`management-api/lib/ontology-apply.js` owns the apply.** The adapter branches on the outcome and delegates; nothing about vault argv, IRI resolution or the ledger lives in the orchestrator. `runVault` and `fetchFn` are injectable, matching the `opts.fetchFn` idiom already in `adapters/beads/external.js` and `adapters/pods/_solid-http-base.js`.

2. **The binary is `$VAULT_BIN`, default `vault`, invoked with an argv array and an allow-listed environment** (`PATH`, `HOME`, `VAULT_ROOT`, `VAULT_BIN`) — the house no-shell rule from `lib/project-tracker.js:27`, which here also means an IRI containing shell metacharacters is data rather than code. That indirection is what lets the whole path be tested today against a stub that records its argv, and needs no change when the real binary lands.

3. **The blast radius is always declared and never widened.** Every edit carries `--expect docs=1,blocks=1`: a decision about one page must touch one page. `vault edit` refuses without it. If the vault disagrees, the edit fails and nothing is written — the correct outcome for a decision whose subject moved underneath it.
   - `Promote` → `--set status=stable --set 'verified+={"by":"human:<npub>","at":"<31403 created_at, ISO>"}'`. `verified+=` is an **append**: OKF trust is a list of attestations, and a human's signature adds to the machine's rather than replacing it.
   - `Demote` → `--set status=deprecated`, and **no** `verified` stamp. Stamping "a human vouches for this" onto a page you just deprecated says the opposite of what happened.
   - The instant is the 31403's own `created_at`, never wall-clock now: the attestation records when the person decided, not when agentbox got round to it.

4. **An IRI is resolved by verification, not by search rank.** `slug()` is lossy, so `urn:ngm:class:rgb-d-camera` is not reversible to a title. We ask `vault find`, then re-slugify each candidate's own id and accept only an exact match. Zero matches or more than one both **stop the write** — two pages claiming one IRI is a corpus conflict the vault gate must resolve, not a tie for this code to break. A `page` carried on the decision is a hint and is verified the same way.

5. **The subject comes from the human's signed bytes.** The IRI is read off the 31403 content, never off the 31402's `context_url`. The request is the agent's claim about what it wants; the response is the person's claim about what they approved, and only the latter was signed by the party whose authority the write rests on.

6. **The Loom ledger is fail-open and never a precondition.** `POST ${LOOM_BASE_URL:-http://loom:8080}/loom/attest` with `{case_id, digest, outcome, signer, at}`. A 404 (WS-H has not deployed the route), a 502, a timeout or a DNS failure is captured as `{attested: false, attestError}` and the apply still reports success — because the page **has** been written, and reporting otherwise would be a lie the ADR-2010 receipt ladder would then carry downstream. Nothing is attested that was not applied: a failed `vault edit` never reaches the ledger call.

7. **A failed apply is recorded, never thrown out of the handler.** The 31403 is signed and durable whatever agentbox manages to do with it. The outcome is reported on the handler's return and in the pod provenance record (`applied`, `applied_page`), leaving the ladder honestly at `not-applied` for a reconciliation retry, rather than losing a human decision because a write failed.

8. **The proposal end runs `vault propose`, not HTTP.** `lib/ontology-propose.js` keeps its validation and attribution and replaces `buildProposeRequest` with `buildVaultProposeCommand` (pure argv, contract C2) plus `runVaultPropose` (executes, returns the `PatchProposal`, contract C4). `buildProposeRequest` and `PROPOSE_PATH` are **deleted rather than deprecated** — a caller still reaching for them must break loudly at require time rather than POST into a wall. The extractor's `propose_request` becomes `propose_command` for the same reason, and the signed 31402 now carries `propose_command` / `propose_iri` / `patch_proposal`.

9. **One slug rule, two users.** `ontology-propose.js` imports `slugify` from `ontology-apply.js` rather than re-implementing it. The invariant is that **the IRI we propose is an IRI the apply path can resolve**: promotion resolves by re-slugifying candidate page ids, so a proposal whose IRI cannot round-trip would strand a human decision at apply time, and two copies of a slug rule drift.

10. **An elevation is a `content` proposal, and `vault propose` runs `--dry-run`.** `content` because it adds one page's own assertions — claiming `schema` would floor every elevation at tier High and make the floor meaningless for the changes that earn it (forum ADR-2013 §3). `--dry-run` because `elevation-publisher` already raises the governed 31402 for the candidate, and letting vault raise a second would put one concept in front of the human twice. What the dry run buys is the **blocker gate the elevation path never had**: per C4 a proposal with non-empty `blockers` is not posted, so a candidate with a Whelk inconsistency, a subclass cycle, a relation contradiction or a vocabulary violation now gets its beam but no 31402. A vault that fails outright is reported per-candidate, not thrown — one bad candidate must not end the sweep.

11. **The outcome is read from `action` first, then `outcome`.** A real forum 31403 keys it `action`; older agentbox publishers wrote `outcome`. Reading both means neither publisher has to change to be understood.

## Consequences

- agentbox becomes a mutation owner for the corpus. It was previously a relay for decisions; it now performs one, which is the thing ADR-2010's application stages exist to report on.
- `nostr-tools` is an optional dependency for the npub form, with a documented hex fallback (matching `relay-consumer.js:519`). A test environment without it stamps `human:<hex>`, which is unambiguous but not the OKF-preferred form; a production pod always has it.
- Everything is exercised with a stub, so a green suite does **not** prove the real `vault` accepts this argv. The e2e script takes `E2E_REAL_VAULT=1` for the day it exists, and the `review_trigger` above is that day.
- Between this change and the VisionClaw image being rebuilt, `ontology-propose-live.smoke.test.js` finds a *reachable* server still serving the old handler. It warns loudly and passes rather than failing on a deployment lag no agent can fix; `ONTOLOGY_RETIREMENT_DEPLOYED=1` makes the 410 assertion binding once the owner has rebuilt.
- `--expect docs=1,blocks=1` is hard-coded rather than configurable. A multi-page decision would need a new outcome, which is the right place for that conversation.

## Verification

`implementation_status: partial` — the handler, the library and the tests are complete and green; the binary they invoke and the route they attest to are two other workstreams'.

At `verified_commit`:

- `node --test management-api/tests/ontology-apply.test.js` — 17 pass. A stub named `vault` is placed **on PATH** (so the default `$VAULT_BIN` resolution is itself under test) and records argv verbatim. Asserted: the exact promote and demote argv; `--expect` present and equal to `docs=1,blocks=1` on every edit; a demotion carrying no `verified+=`; exactness beating rank in IRI resolution (a higher-scored wrong-slug candidate is rejected in favour of a lower-scored right one); refusals for zero matches, two matches, and a page hint that does not answer to its own IRI; a 404 and an unreachable Loom both leaving `applied: true`; a failed edit reaching the ledger zero times; and the handler branch ignoring a plain `approve`.
- `npx jest --testMatch='**/governance-flow.spec.js'` (management-api config) — the 24 pre-existing governance contract assertions still pass, so the relay→handler→provenance path is unchanged for non-ontology outcomes.
- `node --test management-api/tests/ontology-propose-vault.test.js` — 12 pass, same stub-`vault`-on-PATH pattern. Asserted: the exact C2 argv with `--dry-run --json`; `buildProposeRequest`/`PROPOSE_PATH` gone from the module's exports *and* no `path: PROPOSE_PATH` left in its source; an elevation defaulting to `content` and `demotion` refused as a level; an amend naming its target rather than minting one; the proposed IRI round-tripping through the apply path's own `iriSlug` for three awkward terms; a term that slugs to empty refused; blockers surfacing as `blocked: true` with the reasons intact; and a failing vault reported rather than thrown.
- `npx jest` (management-api config, whole suite) — **88 suites, 1462 pass, 0 fail**, including the four WS-G sovereign suites updated to the new contract (`ontology-propose`, `kg-proposal-extractor`, `elevation-publisher`, `ontology-propose-live.smoke`).
- `grep -rn 'ontology-agent/propose' management-api/ mcp/ tests/` returns one comment and no caller.
- `nostr-rust-forum/scripts/e2e-ontology-promotion.sh` — step 4 drives this handler with a **real BIP-340-signed** 31403 from the forum's fixture generator and asserts the same argv, plus that the attestation instant equals the 31403's `created_at` rather than wall clock. 29/29, exit 0.
