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
