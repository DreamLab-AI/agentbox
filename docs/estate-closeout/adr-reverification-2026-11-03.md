# Agentbox ADR source re-verification — 2026-11-03

Source: `c7c2f76b93bfe81dadd8e3bb8c3104cda6b57bec`, clean tracked tree.
Candidate generation: `.agentbox-build/generation-R0LvdF`; immutable image
`sha256:192a2375b620f437b1cef26b9fe6cfd1ecf57dcfa1b2b7152cd565aae81db92a`.
This is source/build evidence, not an online vulnerability clearance or a
whole-estate runtime acceptance. Existing decision/status axes are retained.

## Reconciliation

The external audit narrative was incorrectly stored among decision records;
it is retained as `external-review-2026-11-02.md` in this directory. No checker
exception, verification-path deletion or suppressed staleness rule is added.

The affected records now anchor the current scoped amendment. Their older
verification paragraphs remain dated receipts, not current version/line-number
claims. In particular AoE is retired by ADR-2153, not running behind the proxy;
Solid alpha.17/18 observations do not describe the new alpha.20 package; and
historical Claude/ontology pins do not override the current Nix definitions.

| Changed domain | Reviewed source and conclusion |
| --- | --- |
| Shared composition and policy | `flake.nix`, manifest/schema/catalogue and workflow changes add the immutable VisionCraft release and direct AQE, remove unused precedent-bridge default, and update bounded review policy. No new publish or data-volume migration. |
| Boot and persistent configuration | The entrypoint adds governance secret capture, AQE reconciliation and atomic, owner-preserving RuVector credential scrubbing. Existing instruction projection, vault paths, compaction taint policy, task-token scope and managed floor remain. Scrub is not historical-secret eradication; owner rotation remains manual. |
| Identity and egress | Mirror, gateway, Jarvis and forum callers select purpose-bound IPC under isolation. Redaction/recipient/off-switch checks remain. Role isolation is still off and its live rehearsal is not certified. The W3b authority/delegation/quota/contact/content-policy residuals remain open. |
| Process identity | Ruflo GC checks argv plus start time and uses a pinned pidfd; replacement or unverifiable processes are refused. |
| Dream candidate and governance | Archive trees are reconstructed and checked; repair excerpts use denylist/redaction. Digest shares escaped-pipe parsing and governance follows configured ledger paths, refusing decoys on invalid config. Existing journal and human-decision limits remain. |
| Ontology apply | Explicit promote binds the embedded proposal digest to the approved case before compiler execution. No test writes to the live corpus. |
| Package contracts | Dream core 0.4.1, Ontomark 0.7.3 and Solid alpha.20 use committed locks/fixed hashes and pass the prepared Nix build. AGPL-linked service aggregates are not reclassified as permissive. |
| Sessions and media | Session API remains peer-authorised and protects dirty worktrees. Media sidecar/provisioning source is unchanged by these shared-flake edits. No sidecar recreation or model inference is implied. |

## Executed evidence

- `node config/nip98-proxy/selftest.mjs`: zero failures, zero skips.
- `bash scripts/ci/check-ports-loopback.sh`: publish/listener checks pass.
- `bash scripts/ci/check-crate-licensing.sh`: 11 service packages pass.
- `node scripts/ci/check-manifest-catalogue.js`: 118 gate paths resolve.
- `bash tests/config/role-isolation-supervisor.test.sh`: 25 pass.
- `bash tests/config/boot-projection-contract.test.sh`: 13 pass.
- `bash tests/config/instructions-layers.test.sh`: 12 pass.
- Node session-control, launch-contract, runtime-delivery and ontology-apply
  suites: 99 pass, two live launch-tier checks skipped; no provider round trip.
- Jest egress-boundary, forum/Jarvis gate, Jarvis agent, task-action-token,
  activity-sink and hook-registration suites: 187 pass, six suites.
- Prepared Nix Dream log: 196 unit and 11 integration tests pass, including
  archive identity, escaped ledger cells, configured-path and custody fixtures.
- Prepared Nix bridge suites pass, with real typed-identity/crypto fixtures;
  no production identity key is refreshed by this review.
- Previous preparation evidence: 97 targeted tests and skill lint pass;
  VisionCraft review/cutover/picker tests 23 pass. AQE boot tests three pass
  with a temporary tools PATH because hiding host `/usr/bin/aqe` also hides
  `/usr/bin/bash`; no production fallback or disabled test was introduced.

## Deployment boundary

Re-prepare after committing these documentation changes so activation receives
a matching clean source receipt. Activate only Agentbox with merged Compose,
retaining mount identities, recovery images and data. Check live readiness,
session inventory and MCP hub separately; those observations do not close
Antigravity sign-in, full provider acceptance or any isolated-role rehearsal.
