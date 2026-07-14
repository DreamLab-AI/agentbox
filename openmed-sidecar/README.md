# openmed-sidecar — clinical-PHI redaction (optional, gated, default-off)

An optional sidecar that adds a **clinical/PHI redactor** to the ADR-008 privacy
filter. It is the `local-clinical` backend for `[privacy_filter]` in `agentbox.toml`:
the existing `wrapWithPrivacyFilter` middleware calls this sidecar to redact
protected health information before persistence. No new adapter slot, no new MCP
tool — it reuses the privacy-filter seam.

## Why it is gated and default-off

OpenMed (ruvnet/helix `helix-openmed` + `helix-wasm` + an ONNX model) is genuinely
useful but carries three unresolved prerequisites, each an explicit fail-closed gate
in `[privacy_filter.openmed]`:

1. **`license_acknowledged`** — helix is pre-release (v0.1.0) with an unresolved
   LICENSE. Vendoring the model/pipeline is blocked until the operator verifies the
   licence permits this use.
2. **`onnx_runtime_present`** — agentbox packages no ONNX runtime (the same gap
   PRD-016 deferred for "Kompress ML"). This image provisions one (`onnxruntime-node`);
   the flag records it is available.
3. **`governance_acknowledged`** — a passing redaction gate is **not** HIPAA Safe
   Harbor or Expert Determination (OpenMed's own docs disclaim this). Activation is a
   compliance-posture decision the operator must own.

`prereq-check.sh` enforces all three (plus a SHA-256 verification of the model
artifact) at boot; with the default all-false gates the sidecar refuses to start.

## Layout

```
openmed-sidecar/
  Dockerfile        node:22-slim + onnxruntime-node (the missing runtime) + gate
  prereq-check.sh   fail-closed prerequisite + artifact-lock gate
  entrypoint.sh     gate → serve the operator-provisioned helix pipeline
  healthcheck.sh    /health probe on :9093
```

The helix pipeline (`helix-openmed` / `helix-wasm` / `openmedkit-web`) and the ONNX
model are **not** vendored here (licence-gated). Once the licence resolves, the
operator drops them into `/opt/openmed/server` and provisions the model + its
`artifact_lock_sha256`.

## Operate

```bash
./agentbox.sh openmed up       # build + start (refuses unless prerequisites acknowledged)
./agentbox.sh openmed health
./agentbox.sh openmed down
```

Config: `[privacy_filter.openmed]` in `agentbox.toml`. HMAC key is derived via the
ADR-029 child-key scheme (`hmac_key_tag`) — no new secret store. See
`docs/user/openmed.md`.
