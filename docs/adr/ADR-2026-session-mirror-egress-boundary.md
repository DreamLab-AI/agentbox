---
id: ADR-2026
title: Session-mirror cloud egress boundary
date: 2026-08-31
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: [config/egress-policy.json, config/hooks/lib/egress-policy.cjs, config/hooks/nostr-live-mirror.cjs, services/nostr-pod-bridge/src/egress_policy.rs, services/nostr-pod-bridge/src/session_summary.rs, services/nostr-pod-bridge/src/lib.rs, tests/fixtures/egress-redaction.v1.json]
owner: jjohare
review_trigger: any change to config/hooks/nostr-live-mirror.cjs or the mobile_bridge digest, or the recipient/relay configuration
repo: agentbox
domain: SECURITY-profiles
---

# ADR-2026 — Session-mirror cloud egress boundary

## Context
The live hook mirrors selected lifecycle, prompt and last-assistant text through
NIP-59. A separate Rust SessionEnd path sends flattened transcript text to a
summarisation provider and publishes a signed kind-30840 digest. Source review
and isolated dry-run probes now establish their distinct content and gating
boundaries; deployed configuration, remote retention and delivery remain unverified.

## Decision
The session mirror MUST have a governed boundary that decides, and is enforced by
code checked against this record:
- (a) **Content scope** — exactly what leaves the box, and whether transcript
  bodies are redacted before NIP-59 wrapping (default posture: redact, not raw).
- (b) **Authority model** — the encryption/authority model and which key signs the
  gift-wrapped events and the kind-30840 digests.
- (c) **Off-switch fail-mode** — `AGENTBOX_LIVE_MIRROR=0` and any missing-recipient
  path fail **closed** (no send), not fail-open. Absence of configuration means no
  egress, never unbounded egress.
- (d) **Recipient allowlist** — egress is permitted only to an enumerated set of
  recipient pubkeys, mirroring the ingress allowlist posture of ADR-2012.
The hook has now been inspected, but this record remains proposed and its complete
egress policy remains unverified. The source review does not establish a sovereignty
guarantee.

## Consequences
Brings the mirror under the compliance surface and pairs it with ADR-2012 so both
directions of the relay boundary are governed. Forces an explicit redaction
decision on transcript bodies rather than a silent full-content default. Cost:
fail-closed off-switch semantics and a recipient allowlist may drop mirror events
that today are delivered by default; the hook must gain enforcement code and a
verified_paths anchor before this ADR can move to accepted/complete.

## Verification

2026-09-04 source inspection and isolated probes establish working off/no-identity gates in the live hook, derived-child default and legacy recipient paths, and raw sentinel preservation before wrapping. The digest source sends flattened transcript input to its provider before publication. Neither path establishes the proposed shared redaction/recipient policy. Status changes from none to partial for the existing gates and transport components; decision remains proposed and activation inactive for the complete policy.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `11804ba4b` ("single egress redaction contract"), which landed the acceptance work recorded below. The decision still holds, and the four clauses it demanded now have code behind them: (a) **content scope** — `config/egress-policy.json` enumerates content, recipients, providers, encryption, transport and log retention per path, with `switches`, `invariants` and an `outcomes` vocabulary as top-level keys; (b) **authority model** — the same document names the signing key per path, implemented twice and held together by the paired fixture `tests/fixtures/egress-redaction.v1.json`, which `services/nostr-pod-bridge/src/egress_policy.rs:444-448` loads by `include_str!` so a Node/Rust divergence fails `cargo test` rather than a review; (c) **off-switch fail-mode** — `config/hooks/lib/egress-policy.cjs:143` refuses on the global disable, `:145-147` on the per-path switch (`AGENTBOX_LIVE_MIRROR` / `AGENTBOX_SESSION_DIGEST`), `:152` refuses outright when redaction is disabled, and `:155` when there is no sender identity, each returning `OUTCOME.SKIPPED` (`:29-30`) rather than proceeding; (d) **recipient allowlist** — `:42` resolves the configured allowlist and `:65` denies with `recipient-not-allowlisted`. The live hook now redacts before wrapping at `config/hooks/nostr-live-mirror.cjs:409-411`, where a `null` from `redactForEgress` is a fail-closed skip, closing the reviewed hole where a `password=` sentinel survived into the composed rumor. **The record's own status fields are deliberately left as they are**: `decision_status` stays `proposed` and `activation_status` `inactive` because this pass verified source and fixtures only — no deployed configuration, remote retention or actual delivery was exercised, which is exactly what the record says is missing. `implementation_status` stays `partial`. Commands: `git diff --stat 89301ec7..HEAD -- config/hooks/nostr-live-mirror.cjs services/nostr-pod-bridge/src/`, `grep -n 'OUTCOME\|allowlist\|redaction-disabled' config/hooks/lib/egress-policy.cjs`, `node -e` dump of `config/egress-policy.json` keys.

## Closeout extension — 2026-09-04

CP-04/07/08. Owner remains jjohare with runtime and privacy maintainers. Dependencies: ADR-2027 custody/rotation and effective relay/read policy. The live hook switch is not proof that the separately configured Rust digest path is off. Encryption, summary generation, redaction and delivery are different properties.

**Acceptance condition:** enumerate content, recipients, providers, encryption and log retention per path; enforce redaction before egress; test explicit off, absent identity, child derivation, malformed recipient, configured override and transport failure. Verify both paths with network-denial fixtures and distinguish skipped, attempted and accepted outcomes. Reopen on hook, summariser, key, recipient or transport changes. See the [review](../../../../VisionFlow/docs/estate-review/runtime-egress-and-profiles.md) and [source/probe receipt](../../../../VisionFlow/docs/estate-review/evidence/runtime-egress-probes.json). No real transcript or external send was used.

## Provenance consumer closeout extension — 2026-09-05

CP-04/05/08: [pocket-provenance review](../../../../VisionFlow/docs/estate-review/pocket-provenance.md) verifies naming/composition but reproduces newest-match selection and eviction in the 1,000-event in-memory resolver. Require durable exact decision references, authorised resource lookup and actual phone reconstruction after restart. Nine existing tests and five synthetic route assertions do not establish live delivery or a persisted session-to-decision binding. Preserve the earlier privacy and egress obligations.

## Acceptance progress — 2026-09-05

**Implemented — one policy, two runtimes.** `config/egress-policy.json`
enumerates, per path, the content, recipients, providers, encryption, transport
and log retention, plus the switch table and the outcome vocabulary. It is
implemented twice — `config/hooks/lib/egress-policy.cjs` for the live mirror and
`services/nostr-pod-bridge/src/egress_policy.rs` for the digest — and the two are
held together by a **paired fixture**
(`tests/fixtures/egress-redaction.v1.json`) that both must satisfy exactly. The
Rust test reads that file, so a divergence fails `cargo test` rather than being
noticed later by a reviewer; a shared comment is not a shared contract.

**Implemented — redaction before egress.** The review found no redaction stage at
all between body selection and wrapping, and reproduced a `password=` sentinel
surviving into the composed rumor on both the child-key and explicit-recipient
configurations. The live hook now redacts **before composition and before the
NIP-59 wrap**; the digest path redacts **before the provider request is built**,
because curating the provider's output does not undo its receipt of the input.
Encryption is not redaction, and the code now reflects that ordering. Redaction
failure is a **skip**: `AGENTBOX_EGRESS_REDACTION=0` disables the path rather
than sending raw text, so there is no configuration that egresses unredacted
content.

**Implemented — one off switch, real recipients, honest outcomes.**
`AGENTBOX_EGRESS=0` disables **every** path — the review's point was that setting
the live-hook switch proved nothing about the separately configured Rust path.
Recipients are validated for grammar *and* against an optional enumerated
allowlist. `publishWrap()` previously resolved with nothing on relay-OK,
rejection, socket error, close and timeout alike, which is the mechanical reason
exit zero could not distinguish delivery from failure; it now returns which
outcome occurred, and both paths emit `skipped` / `attempted` / `accepted` /
`failed`. The dry run prints the **redacted** body, so diagnostics never retain
more than the wire.

**Implemented — provenance durability (09-05 extension).**
`management-api/utils/agent-event-archive.js` is a bounded, rotating, fail-open
JSONL archive the publisher appends to *before* eviction can occur, and the
resolver falls back to it. Three consequences: an evicted reference still
resolves; the resolver returns the **full ordered history** for a reference
rather than an arbitrary latest event, reporting `source` and `history_complete`;
and a bare numeric event id is labelled **process-local** and deliberately not
resolved against the archive, because ids restart at 1 in a new process and
matching them across incarnations would return unrelated records and call it a
history. A 404 now names *what was searched*, so "expired", "never existed" and
"could not look" are three different answers. The lookup also matches the CTC
chain id, which previously resolved to nothing.

**Tests and results.** `tests/sovereign/egress-boundary.test.js` — 20 pass;
`tests/sovereign/provenance-durability.test.js` — 9 pass; the Rust
`egress_policy` module — 9 pass; the whole `nostr-pod-bridge` crate — 126 pass, 0
fail. The **network-denial** fixtures point the relay at `ws://127.0.0.1:1`, so
nothing can leave the machine: a denied relay yields ATTEMPTED then FAILED and
never ACCEPTED, a disabled path never reaches ATTEMPTED, and exit zero holds in
all three cases and proves nothing. The off-switch matrix covers explicit global
and per-path off, absent identity, child derivation, child derivation disabled
with an explicit recipient, a malformed recipient, a non-allowlisted recipient
and the redaction-disabled refusal. The provenance suite asserts eviction as a
**precondition** (1,005 unrelated events) before showing the reference still
resolves.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2026-egress-provenance.json`.

**Governed paths changed.** `config/egress-policy.json` (new),
`config/hooks/lib/egress-policy.cjs` (new),
`services/nostr-pod-bridge/src/egress_policy.rs` (new),
`services/nostr-pod-bridge/src/session_summary.rs`,
`services/nostr-pod-bridge/src/lib.rs`, `config/hooks/nostr-live-mirror.cjs`,
`management-api/utils/agent-event-archive.js` (new),
`management-api/utils/agent-event-publisher.js`,
`management-api/routes/agent-events.js`,
`tests/fixtures/egress-redaction.v1.json` (new), plus the two new test suites and
an isolation fix to `tests/sovereign/agent-events-id-resolution.test.js` (its
count assertions encoded the newest-match behaviour this ADR replaces).

**Remaining.** No real transcript, provider call or relay send was exercised: the
digest path is source-verified and unit-tested, not run. The resolver still has
no caller or resource authorisation of its own, so an authorised mobile journey
from decryption through lookup to the original evidence and applied outcome is
not demonstrated. The archive is a provenance record, not a database — retention
is bounded by rotation. Relay/read policy for the signed kind-30840 digest
remains a separate boundary. `decision_status` stays `proposed` pending
maintainer adoption of the policy document.
