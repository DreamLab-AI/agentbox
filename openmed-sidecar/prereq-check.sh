#!/usr/bin/env bash
# Fail-closed prerequisite gate for the OpenMed clinical-PHI sidecar.
#
# The sidecar refuses to serve unless ALL THREE manifest prerequisites are
# acknowledged (mirrors the mainnet guard on the forge/anchoring path). This is
# deliberate: OpenMed is pre-release, licence-unresolved, and a passing redaction
# gate is NOT a regulatory-compliance determination. Activation is an operator
# decision, encoded as config, verified here at boot.
#
# Reads the three gates from the environment (the entrypoint exports them from
# [privacy_filter.openmed] in agentbox.toml):
#   OPENMED_LICENSE_ACKNOWLEDGED, OPENMED_ONNX_RUNTIME_PRESENT,
#   OPENMED_GOVERNANCE_ACKNOWLEDGED  (all must be "true")
#   OPENMED_MODEL_ARTIFACT, OPENMED_ARTIFACT_LOCK_SHA256 (must be present + verify)
set -euo pipefail

fail() { echo "[openmed] BLOCKED: $1" >&2; exit 1; }

[[ "${OPENMED_LICENSE_ACKNOWLEDGED:-false}" == "true" ]] \
  || fail "license_acknowledged is false — helix is pre-release with an unresolved LICENSE. Verify the licence permits this use, then set it in [privacy_filter.openmed]."
[[ "${OPENMED_GOVERNANCE_ACKNOWLEDGED:-false}" == "true" ]] \
  || fail "governance_acknowledged is false — a passing gate is NOT HIPAA Safe Harbor / Expert Determination. Decide the compliance posture, then acknowledge."
[[ "${OPENMED_ONNX_RUNTIME_PRESENT:-false}" == "true" ]] \
  || fail "onnx_runtime_present is false — the ONNX runtime is not confirmed available in this image."

[[ -n "${OPENMED_MODEL_ARTIFACT:-}" ]] \
  || fail "model_artifact is empty — provision the ONNX model into the sidecar and set its path."
[[ -f "${OPENMED_MODEL_ARTIFACT}" ]] \
  || fail "model_artifact ${OPENMED_MODEL_ARTIFACT} not found on disk."

# Verify the artifact against its SHA-256 lock (deterministic supply-chain check).
if [[ -n "${OPENMED_ARTIFACT_LOCK_SHA256:-}" ]]; then
  actual="$(sha256sum "${OPENMED_MODEL_ARTIFACT}" | awk '{print $1}')"
  [[ "${actual}" == "${OPENMED_ARTIFACT_LOCK_SHA256}" ]] \
    || fail "model artifact SHA-256 mismatch: expected ${OPENMED_ARTIFACT_LOCK_SHA256}, got ${actual}."
else
  fail "artifact_lock_sha256 is empty — pin the model's checksum before serving."
fi

echo "[openmed] prerequisites satisfied — clinical redactor may serve."
