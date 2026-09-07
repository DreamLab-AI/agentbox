# Governance operation receipts

Source qualification: 2026-09-07, EA-04. These are local contracts; they do not certify a deployed forum, responder identity provisioning or a completed external mutation.

`management-api/lib/authority.js` requires a concrete operation for actions needing escalation. `governance-correlation.js` canonicalises the JSON and hashes it with SHA-256. The signed kind-31402 includes both operation and digest. A producer that changes the signed content is refused. Both decision consumers require one unambiguous `e` reference to that exact request; optional case/panel identifiers must agree. They never substitute for the request reference. The canonical consumer also verifies the response signature and responder allowlist. Recoverable actions retain their existing policy.

The broker bridge sends the approved operation payload verbatim to VisionClaw. Before sending, `governance-application-receipts.js` durably creates a local immutable `consumer-received` record binding request event ID, response event ID and operation digest. Existing claims prevent repeated execution, including after process restart. An `applied` outcome requires an upstream `writeback_committed: true` acknowledgement. A refusal is `not-applied`; a transport error is `unknown`. An incomplete claim or unknown outcome requires reconciliation with the mutation owner. Storage failures before the claim prevent mutation; receipt failures afterwards preserve the claim and refuse blind replay.

Receipts live under `AGENTBOX_STATE_DIR/governance-applications`, or `~/.local/state/agentbox/governance-applications`. Files are mode0600 and the directory is mode0700 when created. These local records are unsigned, distinct from the legacy best-effort case provenance file. Back up and retain them with the mutation owner's state. Do not delete a received record to retry an uncertain operation: first inspect upstream state and record the resolution through an agreed operational procedure. There is no automated reconciliation command in this change.

LLM grant revocation now signs its concrete grant/actor/reason operation, but its in-memory orderbook is a separate consumer and does not claim the broker bridge's durable external-application guarantee.

Validation:21 focused Node tests and29 authority/consumer/concurrency Jest tests cover operation mutation, mismatched references, refusal, timeout, duplicate dispatch, restart, storage failure and a stubbed upstream committed acknowledgement. The stub is a contract test, not a live application receipt.
