# OpenMed — clinical-PHI redaction sidecar (optional, gated)

## Why this exists

agentbox already ships a local PII redaction sidecar (`openai/privacy-filter`,
Apache-2.0) wired through the ADR-008 privacy-filter middleware. OpenMed adds a
**clinical / protected-health-information (PHI)** redactor on the *same* seam — the
`local-clinical` backend of `[privacy_filter]`. It is an ONNX PHI-detection model
(ruvnet/helix `helix-openmed` policy + `helix-wasm` gates + an ONNX runtime), run as
its own optional sidecar. No new adapter slot, no new MCP tool: the existing
`wrapWithPrivacyFilter` middleware calls it before persistence.

**It is off by default and stays fail-closed until the operator resolves three
prerequisites.** This is deliberate — the fit is architecturally clean, but the
readiness is a governance and licence question, not a code question.

## The three prerequisites (all fail-closed gates)

Set in `[privacy_filter.openmed]` in `agentbox.toml`. The sidecar's `prereq-check.sh`
refuses to serve unless all are satisfied:

| Gate | Why | Default |
|------|-----|---------|
| `license_acknowledged` | helix is pre-release (v0.1.0) with an unresolved LICENSE. Vendoring the model/pipeline is blocked until you verify the licence permits this use. | `false` |
| `onnx_runtime_present` | agentbox packages no ONNX runtime (the gap PRD-016 deferred for "Kompress ML"). The sidecar image provisions one (`onnxruntime-node`); set this once confirmed. | `false` |
| `governance_acknowledged` | A passing redaction gate is **not** HIPAA Safe Harbor or Expert Determination — OpenMed's own docs disclaim this. What compliance you claim is your decision. | `false` |

Plus a `model_artifact` path and its `artifact_lock_sha256`, verified at boot.

## Enabling it

1. **Onboarding wizard** (`./scripts/start-agentbox.sh`) — the Privacy Filter section
   offers OpenMed and walks you through the licence and governance acknowledgements.
2. **Or edit `agentbox.toml`** `[privacy_filter.openmed]` directly:
   ```toml
   [privacy_filter.openmed]
   enabled                 = true
   license_acknowledged    = true   # only after verifying the helix licence
   onnx_runtime_present    = true   # after the sidecar image is built
   governance_acknowledged = true   # after deciding the compliance posture
   model_artifact          = "/opt/openmed/model/openmed-int8.onnx"
   artifact_lock_sha256    = "<sha256 of the model file>"
   ```
   and set `[privacy_filter].mode = "local-clinical"` to route clinical slots to it.
3. **Provision the pipeline** — the helix pipeline and the ONNX model are *not*
   vendored (licence-gated). Once the licence resolves, drop them into
   `openmed-sidecar/server` + `openmed-sidecar/model` (both git-ignored) and set the
   `model_artifact`/`artifact_lock_sha256` above.
4. **Bring it up**: `./agentbox.sh openmed up` (build + start; refuses if gated),
   then `./agentbox.sh openmed health`.

## Secrets

The HMAC key OpenMed requires is derived via the ADR-029 child-key scheme
(`HMAC-SHA256(operator_sk, hmac_key_tag)`) — the same pattern as the Nostr mirror
key. No new secret store is introduced. The key is injected at runtime, never baked
into the image or committed.

## Files

```
docker-compose.openmed.yml    the gated sidecar service (loopback :9093)
openmed-sidecar/
  Dockerfile                  node:22-slim + onnxruntime-node + the gate
  prereq-check.sh             fail-closed prerequisite + artifact-lock check
  entrypoint.sh               gate → serve the provisioned helix pipeline
  healthcheck.sh              /health probe
```

Operate with `./agentbox.sh openmed <up|down|health|logs|status|rebuild|shell>`.
