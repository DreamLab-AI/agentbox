---
id: ADR-2026
title: Session-mirror cloud egress boundary
date: 2026-08-31
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: any change to config/hooks/nostr-live-mirror.cjs or the mobile_bridge digest, or the recipient/relay configuration
repo: agentbox
domain: SECURITY-profiles
---

# ADR-2026 — Session-mirror cloud egress boundary

## Context
Every session turn is mirrored to an external Cloudflare-Worker nostr relay
(`wss://dreamlab-nostr-relay...workers.dev`) via `config/hooks/nostr-live-mirror.cjs`
— NIP-59 gift-wrapped self-DMs plus kind-30840 digests through the
`mobile_bridge` (per workspace CLAUDE.md). ADR-2012 governs relay *ingress*
(allowlist-only, no fallback, no auto-add); nothing governs this *egress* of full
transcripts off-box to third-party infrastructure. For an estate whose thesis is
sovereignty and email privacy, an ungoverned exfiltration channel sits outside the
compliance surface. This is UNVERIFIED at the code level — the hook has not been
inspected this pass.

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
Until this record is ratified and the hook is inspected against it, the mirror is
treated as an unaudited egress channel and is not covered by the sovereignty
guarantee.

## Consequences
Brings the mirror under the compliance surface and pairs it with ADR-2012 so both
directions of the relay boundary are governed. Forces an explicit redaction
decision on transcript bodies rather than a silent full-content default. Cost:
fail-closed off-switch semantics and a recipient allowlist may drop mirror events
that today are delivered by default; the hook must gain enforcement code and a
verified_paths anchor before this ADR can move to accepted/complete.

## Verification
None yet — this record is `proposed` / `implementation_status: none`. NEXT STEP is
to inspect `config/hooks/nostr-live-mirror.cjs` and the `[sovereign_mesh.mobile_bridge]`
digest path, record the actual content scope, key, fail-mode and recipient handling
as findings, then set `verified_commit`/`verified_paths` and advance the status.
