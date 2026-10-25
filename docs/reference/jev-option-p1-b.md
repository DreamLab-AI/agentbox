# Jev option — P1 batch B (agentbox)

Opt-in typed decisions (System One: Choice / Score / Noul) beside existing behaviour. **Every flag is off by default. With a flag off, no request is built and nothing leaves the process.** Every item falls back to its pre-change output on: flag off, no endpoint, transport error, timeout, any non-2xx, an unparsable body, a missing answer id, a Choice key outside the offered set, or confidence below the configured threshold. Fallback never throws and logs one line with the reason (`flag-off`, `no-endpoint`, `local-only`, `timeout`, `network`, `http-<code>`, `malformed`, `low-confidence`) and no request content.

Each item is a proposed research candidate; **no measured uplift is claimed.** Wiring and fallback tests do not show uplift.

Endpoint resolution (shared adapter `config/hooks/lib/jev-option.cjs`, `guides/jev-option-contract.md` §2): explicit config, else the ADR-2139 loopback proxy (`AGENTBOX_SYSTEM_ONE_PROXY=1` with `AGENTBOX_SYSTEM_ONE_ENDPOINT` + `AGENTBOX_SYSTEM_ONE_MODEL`, no Authorization header), else `api.typesafe.ai` with `TYPESAFE_API_KEY`, else unavailable. A local-only consumer refuses the proxy and the cloud unless `AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1`.

| Item | Flag | Code path | Question set | Authority kept in code |
| --- | --- | --- | --- | --- |
| AB-15-S1-01 | `AGENTBOX_JEV_CONSULT_ADVICE` | `mcp/consultants/shared/consult-advice.js`, `consultant-base.js` (`consult_advice` tool, listed only when on) | `ab15-consult-advice/1` | `consult`, spend caps and model availability untouched; no paid route is offered when code says budget is spent |
| AB-21-S1-01 | `AGENTBOX_JEV_TRAJECTORY_CLASSIFY` | `mcp/servers/lib/trajectory-pattern-jev.js`, `aggregate-effectiveness.js` `run()` | `ab21-trajectory-pattern/1` | grouping, recency weights, sample floors, Wilson bounds and ADR-2017 gates unchanged; annotation only |
| AB-23-S1-01 (+ VF-04 host, local screening) | `AGENTBOX_JEV_DREAM_TRIAGE` (+ `_DEFER_BELOW`, `_LOCAL_ONLY`); asks the repo's `extraDisciplines` as violation Nouls | `services/dream-engine/src/jev_triage.rs`, `engine.rs` step 8b | `ab23-dream-triage/1` | gate, evaluators, isolation and merge gate unchanged; a high score never means ACCEPT; deferral needs an explicit threshold and leaves the ACCEPT unproven |
| AB-24-S1-01/02 | `AGENTBOX_JEV_ONTOLOGY_RELEVANCE`, `AGENTBOX_JEV_ONTOLOGY_RERANK` | `mcp/servers/lib/ontology-jev.js`, `ontology-retrieval.js` `ask()` | `ab24-ontology-grounding/1` | shadow-only until `..._RERANK_APPLY_MIN_CONFIDENCE` / `..._PASSTHROUGH_MIN_CONFIDENCE` are set; `scaffold:false` wins; maturity/domain gate, generation identity, cache-constraint check and budget clamp unchanged |
| AB-25-S1-01 | `AGENTBOX_JEV_ONTOLOGY_PROPOSALS` | `config/hooks/lib/ontology-proposal-jev.cjs`, `ontology-monitor.cjs` | `ab25-ontology-proposal/1` | verdicts in a separate unsigned file, never in the 31402; nothing held unless `AGENTBOX_JEV_PROPOSAL_HOLD_BELOW` is set; email-tainted transcript ⇒ local-only |
| AB-26-S1-01 | `AGENTBOX_JEV_HEADROOM_EVIDENCE` | `management-api/lib/headroom-evidence.js`; production caller `routes/memory.js` `POST /v1/memory/search` (before `headroom.compress`); `headroom.js` `compressSelected` for others | `ab26-headroom-evidence/1` | local-only; reorder and annotate, no drop path; originals stay in the CCR store |
| ES-05-S1-01 | `AGENTBOX_JEV_GOVERNANCE_RUBRIC` | `management-api/lib/governance-evidence-rubric.js`, `elevation-publisher.js` | `governance-evidence-quality/1` | after the card is built; sidecar only; `authority: "none"` |
| ES-06-S1-01 | — | **BLOCKED**: the email gateway is not in this repository | — | — |

## Overlap with shipped code

- **AB-15 vs jev-checkpoints (ADR-2135).** The plugin times the in-session Opus advisor: its Jev request is `config/claude-plugins/jev-checkpoints/hooks/jev.ts:155`, its output is the nudge text at `hooks/text.ts:70-73`, driven from `hooks/register.ts`. Nothing in it references the consultant MCP servers (`mcp/consultants/shared/consultant-base.js:270` `_handleConsult`). Only the consultant path is added.
- **AB-26 vs factrail compaction (ADR-2121/2093, `lib/factrail.nix:3-6`, `[features.jev_compaction]` in `agentbox.toml:742-785`).** Compaction decides what a Claude Code session's compaction keeps. It does not see headroom's slots (`management-api/lib/headroom.js` `compress`). Only the headroom path is added.
- **AB-22** (the live router) belongs to branch `feat/jev-option-p1-a`; its shared adapter is reused here byte-for-byte.

## Thresholds

Defaults accept nothing wherever a decision would change an outcome: the AB-23 deferral (`..._DEFER_BELOW`) and the AB-25 hold (`AGENTBOX_JEV_PROPOSAL_HOLD_BELOW`) are unset by default and refuse any value above 0.5, because a Noul near 0.5 means uncertainty; AB-24 rerank/passthrough are shadow-only until their thresholds are set. ES-05 is annotation-only with no threshold. None of the thresholds has been fitted on labelled data.

## Enabling the dream-engine option

`[program:dream-engine]` (`flake.nix` ~2892) passes a fixed `environment=` and inherits the rest from the entrypoint launcher. `AGENTBOX_JEV_DREAM_TRIAGE`, `AGENTBOX_SYSTEM_ONE_PROXY` and the endpoint names (`AGENTBOX_SYSTEM_ONE_ENDPOINT` or `AGENTBOX_SKILL_ROUTE_API`, which `jev_triage.rs` accepts like the shared adapter) must reach that process; wiring them in is a rebuild-class change and is deliberately not made here.

## ES-05 — consuming the shared rubric from the forum and VisionClaw

The question set is a language-neutral JSON file: `management-api/lib/rubrics/governance-evidence-quality.v1.json` (`agentbox/governance-evidence-rubric@1`). Other surfaces load the **same bytes**, not a re-statement:

1. Verify the file's digest: `sha256` over its canonical JSON (object keys sorted, no insignificant whitespace, arrays in order). The pinned value for v1 is `3a338a77939ffec84e03413186619b6e58ad59f8d098543a9e127987fc9a6910`. A changed question is a new version and a new digest; signals from different digests are not comparable.
2. Compute the **request digest** over the unsigned action request exactly as the approver sees it: `sha256(canonical_json({"content": <event.content>, "kind": <event.kind>, "tags": <event.tags>}))`, lowercase hex.
3. Send `state` (`title`, `subject {kind,id}`, `rationale`, `evidence`, `context_url`) and the file's `questions` verbatim to `POST /v1/systemone`. Noul yields a probability of yes; Score is normalised as `score/(levels−1)`.
4. Record `{request_digest, rubric, rubric_sha256, authority:"none", signals}` **beside** the request. Do not embed it in the signed event, and do not let any signal gate, imply or replace an approver signature, a dispatch or a mutation-owner receipt.

## Egress

Seven inactive rows (`*-jev-option`) sit after `system-one-local` in `config/egress-policy.json`; the register in `docs/SECURITY-profiles.md` is regenerated by `node scripts/ci/render-egress-register.js`.
