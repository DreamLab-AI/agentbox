# System One activation — 29 October 2026

Activation is staged in source, pending rebuild and service deployment. The
running public vendor remains SubQ. Private consumers use the separately declared
keyless `laya` backend at `http://systemone:8097/v1/systemone`; locality is never
inferred from a loopback proxy address.

`[system_one.consumers]` enables failure classification, manifest planning, voice
interpretation, approval review, consultant advice, memory reranking, trajectory
annotation, skill intent/verification, ontology relevance/reranking/proposal
review, headroom evidence, governance evidence, VisionFlow checks, website
advisories, Solid suggestions, Ontomark suggestions and vault patch ranking.
`features.jev_checkpoints.claim_check` and `dream_machine.jev_triage` are also on.
The same projection reaches supervisor children before launch and interactive
shells through runtime-env. A flag in a shell alone cannot update a daemon.

Build the Agentbox image and the local System One sidecar. The sidecar response
must include the question type; older versions answer HTTP 200 but strict forum,
Solid and Ontomark clients reject the missing discriminator. Vault, Ontomark and
Solid source pins now include Jev and their Cargo features are gated by the
corresponding consumer switches. Turning them off removes the optional build.

Deployment outside Agentbox remains separate: VisionClaw/Codescape and email
compose environments, Loom profiles, and website/forum Worker deployments carry
their own flags. Remote Loom needs a reachable sovereign endpoint. Cloudflare
cannot reach Docker DNS or localhost: its private rationale check requires an
authenticated sovereign ingress; public workers need their configured vendor
secret. Existing forum search entries need public snippets ingested before they
can be reranked. No deployed Ontomark Obsidian plugin was found to configure.
Library-only hooks without a host are not deployment switches.

All outcome-changing confidence thresholds remain governed by their existing
semantics. Unset thresholds still mean shadow/advice-only, including dream
candidate deferral and automatic ontology/voice changes. This enables observation
without claiming unmeasured model quality or bypassing authorisation.

Verification logs are retained in `workspace/reports/systemone-enable-20261029`
and `workspace/agent-runs/systemone-enable-20261029`. The mandatory before/after
memory-recall run cannot score: six frozen fixture IDs are missing. Repairing that
fixture and establishing a valid baseline is required for a recall claim; unit
fallback tests cannot substitute for it.


## Executed checks

- Agentbox: 183 option/fallback tests, 37 checkpoint/memory tests, 12 projector
  tests, 20 dream-triage tests, 2 boot-activation tests and 8 setup drift tests
  passed. Rust projector clippy passed. All five adapter slots passed 169 tests;
  34 existing contract TODOs remain. Supervisor parity passed 25 tests and the
  secret-variable inventory passed (728 names).
- The façade passed 60 tests, including an HTTP test for all three answer types.
  Synthetic live local Choice/Score/Noul completed successfully in 133 ms.
- Exact upstream pins: Vault 391 passed (5 diagnostic/scaling tests ignored),
  Ontomark CLI/adapter 59 passed, Solid 23 Jev/forge tests passed with its shipped
  feature check, and the identity bridge compiled with its unchanged lock.
- Other repositories: Forum 806 tests; email 21; VisionFlow 62; website 37 plus
  3 activation tests and a full build; Codescape 11; VisionClaw 80 adapter tests,
  deployment/live-wire checks, 83 deployment checks, server compilation and
  type generation passed.

VisionClaw's full handler-test build is blocked by existing GPU fixture/import
problems. Loom's Rust suite is blocked by its missing pinned RuVector sibling.
Loom Compose configuration was checked. These are not recorded as passing tests.
The memory fixture failure above remains unresolved. Rebuild-time image/SBOM/VEX
checks and post-activation runtime receipts still need the candidate image.


The pre-rebuild Deepsec run reported one high-severity pre-existing bootstrap
credential-symlink write, redirect following in dream triage, and an unbounded
response-body wait in the shared adapter. All three were fixed and checked with
planted-symlink, stalled-body and real HTTP307 regressions. The original report
remains BLOCK; targeted remediation evidence does not relabel it a clean rescan.
