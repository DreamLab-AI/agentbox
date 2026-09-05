---
id: ADR-2012
title: Relay ingress is allowlist-only with no fallback and no auto-add
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: [agentbox.toml, flake.nix]
owner: jjohare
review_trigger: ingress_policy changes from allowlist, or the ADR-040 D3 governance-publisher key-split lands
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-040 (learning consumers / governance publisher key-split), sovereign-mesh relay posture (DDD-003)
---

# ADR-2012 — Relay ingress is allowlist-only, no fallback, no auto-add

## Context
The embedded nostr-rs-relay accepts inbound events from the mesh. An open or
signed-only relay would admit any well-formed event; the sovereign posture
requires that only known keys can write. Earlier designs auto-added the operator
pubkey at boot — that claim now matches no code and is a silent trust widening.
The allowlist is baked at nix build from `relayAllowedPubkeysCsv`, so its
contents are a build-time artefact. Governing doc: `docs/INGRESS-identity.md`.

## Decision
Relay ingress policy is `allowlist` — not `signed-only`, not `open`. Inbound
events are admitted only from a static list of 64-hex pubkeys baked at build
time. There is no fallback and no auto-add: the operator pubkey is not
auto-inserted at boot, and an empty allowlist drops every inbound event.
Per-agent event emission additionally requires NIP-98 (`agent_event_auth =
"nip98"`). This forecloses open/signed-only relay modes and any runtime
widening of who may write to the relay.

## Consequences
The intended boundary permits only enumerated publishers. Current bridge
enforcement is at inbox consumption, not relay admission (see closeout below). Cost: allowlist changes are build-baked — adding a publisher needs a
rebuild and is staged to the next deploy, not hot-editable. Open follow-on: the
ADR-040 D3 governance-publisher key-split is still pending, so the
visionclaw-server publisher key is currently shared rather than split.

## Verification
Re-checked at `cbe7335b9`: `agentbox.toml:138` (`ingress_policy = "allowlist"`),
`:140-141` (comment: "NO fallback and NO auto-add: empty = every inbound relay
event is dropped"), `:144-153` (static `allowed_pubkeys`), `:172`
(`agent_event_auth = "nip98"`), `:148` (key-split pending, ADR-040 D3). Baked via
`flake.nix:1186` (`relayAllowedPubkeysCsv`), exported as
`AGENTBOX_ALLOWED_PUBKEYS` at `flake.nix:1852`.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `11804ba4b` (the relay-admission fix this record's acceptance section describes: `flake.nix` now emits an explicit empty `pubkey_whitelist` rather than omitting the key) and by `agentbox.toml` gate additions elsewhere in the manifest. The decision still holds and is now enforced at the boundary it names. Re-checked at HEAD: `agentbox.toml:138` (`ingress_policy = "allowlist"`), `:140-141` ("NO fallback and NO auto-add … empty = every inbound relay event is dropped"), `:144-148` (static `allowed_pubkeys`, key-split still pending per ADR-040 D3 at `:148`), `:172` (`agent_event_auth = "nip98"`). Baked at `flake.nix:1436` (`relayAllowedPubkeysCsv`) and exported as `AGENTBOX_ALLOWED_PUBKEYS` at `flake.nix:2188` (the previously cited `:1186`/`:1852` have drifted). The deny-all defect is closed at `flake.nix:1440-1452`: the generator emits `pubkey_whitelist = [ ]` for an empty list with the `Option<Vec<String>>` rationale inline. Admission is at the relay boundary in `services/nostr-pod-bridge/src/admission.rs:101-109`, refusing unlisted authors and the empty-allowlist case with distinct NIP-20 `blocked:` reasons. `implementation_status` stays `partial`: the ADR-040 D3 publisher key-split is still outstanding and no deployed relay send was exercised. Commands: `git diff 89301ec7..HEAD -- agentbox.toml flake.nix`, `grep -n 'ingress_policy\|allowed_pubkeys\|agent_event_auth' agentbox.toml`, `grep -n 'pubkey_whitelist\|AGENTBOX_ALLOWED_PUBKEYS' flake.nix`.

## Closeout extension — 2026-09-04

CP-01/04/08. Owner remains jjohare with relay/identity maintainers. Implementation is partial: the bridge startup passes its allowlist to the inbox consumer, while the embedded relay verifies, stores/broadcasts and acknowledges events before consumer authorisation. Empty denies inbox processing; it does not implement the declared relay-wide rejection. Three existing helper tests pass for listed, unknown and delegation-tag authors. Historical live status remains without a fresh deployment claim.

The standalone config generator omits `pubkey_whitelist` for an empty list and separately enables NIP-42. Its effective empty/default behaviour has not been executed or certified. Validator W039 still describes a local-npub fallback; that message is not an implemented bridge fallback. Reconcile the message, both backend policies and this intended decision.

**Acceptance condition:** Place publisher admission at the chosen relay boundary, or explicitly adopt a distinct relay/inbox contract. Exercise allowed/unlisted/self authors, empty policy, gift wrapping, subscriber visibility, removal/restart, consumer lag and durable delivery. Distinguish relay OK from authorised inbox commit and define replay/recovery. Capture build/backend identity and effective key list; retain the pending publisher-key split as a separate authority dependency. Reopen on backend, admission, key projection or consumer changes. See [review](../../../../VisionFlow/docs/estate-review/runtime-ingress.md#relay-admission-versus-inbox-authorisation) and [receipt](../../../../VisionFlow/docs/estate-review/evidence/relay-admission-snapshot.json). No relay send, pod write or deployment ran.

## Acceptance progress — 2026-09-05

**Implemented.** Publisher admission moved to the relay boundary, and both
reconciliation items in the closeout are done.

- *Admission at the boundary.* `services/nostr-pod-bridge/src/admission.rs` (new)
  gates `EVENT` frames **before** the embedded relay verifies, stores, broadcasts
  or acknowledges them. An unlisted author is refused with a NIP-20 negative
  `["OK", <id>, false, "blocked: …"]` and never reaches the relay or the pod
  inbox — previously the relay acknowledged first and the consumer authorised
  afterwards. Relay-OK and authorised-inbox-commit remain distinct outcomes and
  are logged and counted separately, with an audit record under
  `pods/<recipient>/events/audit/relay-admission.jsonl`.
- *Empty allowlist.* Defined as **DENY-ALL** and applied consistently at both
  boundaries with its own counter, rather than denying inbox processing while the
  relay stayed open.
- *Config generator.* `flake.nix` now emits an explicit empty `pubkey_whitelist`
  for an empty list instead of omitting the key. That omission was the defect:
  `nostr-rs-relay` reads the field as `Option<Vec<String>>`, so omitting it
  yields `None` and the author check is **skipped entirely** — the relay accepts
  every author, the opposite of this decision — while `[ ]` yields `Some([])`
  whose membership test is false for every author. NIP-42 stays on for every
  non-open policy; the two settings answer different questions (prove which key
  you hold, versus may that key write) and the interaction is documented at the
  generator.
- *Validator W039.* The message no longer describes a local-npub fallback that
  neither backend implements. It states the real deny-all consequence for both,
  and notes that the embedded bridge still publishes its own locally-signed
  egress because that is not remote publication.

**Tests and results.** `cd services/nostr-pod-bridge && cargo test --offline` —
**117 passed, 0 failed** (46 + 11 + 10 + 15 + 35 across the suites), extending
rather than replacing the three existing helper tests; covers listed author
admitted, unlisted author refused **before** store/broadcast/ack, empty allowlist
denying all, self author, and delegation-tag author.
`node node_modules/.bin/jest tests/config/semantic-rules.test.js -t W039` —
**3 passed**.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2012-relay-admission.json`.

**Remaining.** No relay send, pod write or deployment ran. Subscriber visibility,
consumer lag, durable delivery, gift wrapping and replay/recovery are not
exercised against a running relay; build/backend identity and the effective key
list were not captured from a deployment; the pending publisher-key split remains
a separate authority dependency. Historical live status is retained, not
re-certified.

**Governed paths changed.** `services/nostr-pod-bridge/src/admission.rs` (new),
`services/nostr-pod-bridge/src/lib.rs`, `services/nostr-pod-bridge/src/main.rs`,
`services/nostr-pod-bridge/Cargo.toml`, `flake.nix` (relay config generator
only), `scripts/agentbox-config-validate.js` (W039 only),
`tests/config/semantic-rules.test.js` (W039 block only).

### Re-verification 2026-09-05

Re-verified at `verified_commit` 89301ec7c911eab270c00a0cf81596d0d4f15535, on the
uncommitted working tree above that SHA; re-run at the landing commit. Staleness
was `agentbox.toml` and `flake.nix` drift; `verified_paths` is emptied for the
landing commit to repopulate.

- **Allowlist content unchanged, six entries.** `agentbox.toml:144-153`
  `allowed_pubkeys` still carries operator-jjohare, visionclaw-server (governance
  publisher), beema, RedDread, junkiejarvis, and the operator's mobile. The
  ADR-040 D3 key-split remains **pending** and is still annotated inline at the
  `visionclaw-server` entry, so this ADR's `review_trigger` has not fired.
- **Build-time projection unchanged.** `flake.nix:1382` still builds
  `relayAllowedPubkeysCsv` by `concatStringsSep ","`, and `flake.nix:2122` still
  passes it to the relay program as `AGENTBOX_ALLOWED_PUBKEYS`. The allowlist is
  therefore still baked at nix build: a revocation costs an image rebuild, which
  is the compromise window ADR-2027 records against this credential.
- **Deny-all-on-empty is implemented and named.** `services/nostr-pod-bridge/src/admission.rs:93`
  defines `RejectReason::DenyAllEmptyAllowlist`, distinct from `:91`
  `NotAllowListed`, and both are counted and surfaced (`:105-108`). The module
  header at `:38` states the invariant directly. An empty allowlist drops every
  remote publisher — no fallback, no auto-add.
- **The two boundaries stay distinct, and that is the residual `partial`.**
  `admission.rs:19-33` records that relay admission and inbox authorisation are
  separate: a relay `OK` is a transport acknowledgement, not an authorised commit.
  `admission.rs:1-17` records the historical gap this closed — the relay formerly
  stored, broadcast and positively acked *before* the inbox consumer authorised.

**New finding raised by the 2026-09-05 diagram pass (AB-13.1, AB-13.7).** The
crate header at `services/nostr-pod-bridge/src/lib.rs:3-4` states this crate
"replaces the third-party `nostr-rs-relay` binary **and** the hand-rolled JS crypto
in `mcp/nostr-bridge/relay-consumer.js`". That replacement is incomplete in the
running system: `management-api/server.js:1265` still gates on
`AGENTBOX_RELAY_POD_BRIDGE === 'true'` and `:1274-1303` constructs and starts
`new RelayConsumer(...)`, logging "RelayConsumer started — pod-bridge active". Two
consumers therefore subscribe to the same embedded relay and write the same
`pods/<npub>/events/inbox/<id>.json` path under independent allowlists, which
weakens the single-admission-point property this ADR asserts. Remediation is
ADR-2043; the `server.js` edit is routed to the ab-runtime lead because that file
is theirs.
