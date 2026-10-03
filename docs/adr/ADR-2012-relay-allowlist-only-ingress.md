---
id: ADR-2012
title: Relay ingress is allowlist-only with no fallback and no auto-add
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: b41d9486c55e32c332f26e87f82271ee65ea24f5
verified_paths: [agentbox.toml, flake.nix]
owner: jjohare
review_trigger: ingress_policy changes from allowlist, or the ADR-040 D3 governance-publisher key-split lands
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-040 (learning consumers / governance publisher key-split), sovereign-mesh relay posture (DDD-003)
---

# ADR-2012 — Relay ingress is allowlist-only, no fallback, no auto-add

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `agentbox.toml` changes only inside `[features.jev_compaction]` (comments, `min_reduction_ratio` removed, five new keys); `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (runtime packaging changes)

The ontology-runtime removal, Codex package volume, Compose refresh, and
sidechain checkout pin do not change relay admission, allowed identities, or
kind policy. The NIP-98 ingress self-test passes with zero failures/skips.
Source anchor: `47e187934`.

## Re-verification — 2026-10-01 (dependency refresh)

Manifest changes affect Jev reduction and Loom model discovery, not relay admission or allowed keys/kinds. The upgraded Rust bridge now runs its complete 134-test suite in Nix, including relay admission, with its paired fixture and Git test dependency present.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

Volume-identity correction at `efdb79475`: already-prefixed names are retained by the generator. The new resolved-Compose test passes for 15 persistent volume identities, the external Claude home, read-only instructions and PID parity. This changes no service authorization or published ports.

Packaging follow-up at `fc8ba7a7b`: the config copy now filters out mount-only instruction layers. Rechecked the changed Nix expression; it does not alter this record's runtime gates, auth commands or port inventory. The local test evidence below remains applicable.

Re-read the manifest allowlist/nip98 gates and the generator's explicit empty pubkey_whitelist branch. The instruction-home and Compose changes do not alter publisher admission or add a publisher. No relay publication was performed; the publisher-key split remains deferred. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

The manifest adds only the sidechain block; relay admission, baked allowlist and per-agent NIP-98 policy are unchanged. Public sidechain relay traffic does not widen the embedded relay allowlist.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context
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

**Acceptance condition:** Place publisher admission at the chosen relay boundary, or explicitly adopt a distinct relay/inbox contract. Exercise allowed/unlisted/self authors, empty policy, gift wrapping, subscriber visibility, removal/restart, consumer lag and durable delivery. Distinguish relay OK from authorised inbox commit and define replay/recovery. Capture build/backend identity and effective key list; retain the pending publisher-key split as a separate authority dependency. Reopen on backend, admission, key projection or consumer changes. See [review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-ingress.md#relay-admission-versus-inbox-authorisation) and [receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/relay-admission-snapshot.json). No relay send, pod write or deployment ran.

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

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: agentbox.toml: a new `[skills.podcast_ingest]` section (ADR-2057) only; every section this record governs is untouched; flake.nix: the aoe-profiles volume entry and baseline volume name (ADR-2063) and the `lib.optionalString podcastIngestEnabled` wrapper around [program:podcast-cron] (ADR-2057); the aoe-serve, nip98-proxy, relay and proxy blocks are byte-identical. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: agentbox.toml, flake.nix. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.


## Bounded source re-verification — 2026-09-07

The flake delta adds only secretBackupPkg; relay local/admission/bind expressions are unchanged. The exposed-relay profile remains disabled. The complete intervening change to the governed source was reviewed at `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; prior runtime/approval limitations remain.

### 2026-09-07 npm closure re-verification

The intervening governed `flake.nix` change adds exact package-lock inputs for
the nine existing npm CLIs and updates five dependency-output hashes after a
manifest-by-manifest comparison. No existing package version changed; additions
are optional musl packages already present in the original locks. All nine
fixed-output derivations passed an explicit the connected node `nix build --rebuild` replay.
This changes reproducible package installation, not the ADR's admission, custody
or publication rule. Source verification is renewed at this commit; existing
activation evidence and limits remain unchanged. The active local container was
not replaced, and no key was rotated.

### 2026-09-07 documentation and workflow pin re-verification

The governed manifest diff at `7bf2382c031d696b0b2f5eb466f7e6615c88cc2c`
adds only two comments distinguishing the consultant wire alias from the documented
weight variant. The invariants workflow replaces action version tags with exact
commit pins and retains the same checks. Neither diff changes this decision’s
runtime behaviour; existing implementation and activation qualifications remain.

### 2026-09-07 development-shell re-verification

The only intervening governed flake change selects the upstream executable
`nix2container.packages.${system}.nix2container-bin` for devShell buildInputs;
the former `n2c.nix2container` attribute does not exist. The selected executable
derivation evaluates on the pinned the connected node input. Container package selection,
admission and custody behaviour are unchanged by this development-shell repair.
Existing runtime activation limits remain. Verification is renewed at
`8fcc7b79b7c93c0744ca68b7a09fa14fdae8f5e3`; the project flake.lock has not been updated.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): agentbox.toml. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff 8fcc7b79b..ee742ade5 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by feature blocks added to `agentbox.toml` (colloquy, jev-compaction, skills.routing) and by unrelated `flake.nix` churn. The posture itself is unchanged at `HEAD`: `agentbox.toml:151 ingress_policy = "allowlist"` with the "there is NO fallback and NO auto-add: empty = every inbound relay event is dropped" comment and the explicit `allowed_pubkeys` list (`:157-`); `flake.nix:1499-1519` still emits `pubkey_whitelist = [ ]  # ADR-2012 deny-all` for an empty allowlist and only turns the gate off for `ingress_policy = "open"`. Claim STILL TRUE.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by `agentbox.toml` alone (`b680a7ae`, ADR-2094 Sovereign System One); `flake.nix` is unchanged since the previous anchor. `git diff b680a7ae..HEAD -- agentbox.toml flake.nix` shows one addition: a `[features.sovereign_system_one]` block with `enabled = false`. It adds no publisher, no relay mode and no ingress path — the allowlist sections this record governs are untouched. Re-read at HEAD in a detached worktree: relay ingress policy and the 64-hex allowlist are as recorded, `agent_event_auth = "nip98"` stands, and nothing auto-inserts the operator pubkey. Claim STILL TRUE.

**2026-09-21 re-verified at `ab785f08c`.** Governed paths changed by the ADR-2105 kind move: agentbox.toml. This record governs `[sovereign_mesh.relay]` directly, so the diff was read in full: `ingress_policy = "allowlist"` (`agentbox.toml:151`) and `allowed_pubkeys` (`:157`) are untouched, and the only change is six kind numbers (38410-38415) appended to `allowed_kinds` with an explanatory comment. `allowed_kinds` widens *what* an already-admitted publisher may write, never *who* may write; the allowlist-only admission decision and its invariant hold unchanged. Re-verified by `git diff 1639f86ab..224afae65 -- agentbox.toml flake.nix`.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `agentbox.toml`: `[vault]` gains the optional `repo` key (the vault repository root, exported as `VAULT_REPO`); `format` comments now state `obsidian` is the only value; one comment reworded ("logseq corpus" → "vault corpus"). `flake.nix`: statix lint only — assignment→`inherit` (with `or` defaults preserved as `inherit ({ defaults } // cfg)`), redundant parentheses dropped, `(x or false) == true` rewritten as `let v = x or false; in builtins.isBool v && v` (same result for every input), and one comment reworded ("logseq corpus" → "vault corpus"). No derivation, port, service, gate or package changed. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `agentbox.toml` changes only in `[integrations.solid_pod_rs]`: `sign_requests` false→true and the comment block above it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `agentbox.toml` adds the `[sidechain.dreamlab-txbt4]` table, with `enabled = false`. No other key changed. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. No relay configuration or ingress path changed. The new producer talks to public relays as an outbound client, exactly as `sidestr-producer` already does. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-02 (`6db0ffc8df1e708047c210353f730d1f0427553d`)

Tripped by ADR-2097 (the sidestr payment rail). `agentbox.toml` gains one new table, `[payments.sidestr]` (ADR-2097), placed after `[skills.payment_router]`; no existing key, value or line above it moves. Nothing this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff f7465412d..6db0ffc8d -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`e434a7a596a3a0518c51b7da107d6e0831891910`)

Tripped by the sidechain health and witness change. `agentbox.toml` changed only in `[voice]`: `enabled` false → true, with a comment, so that the descriptive sidecar state matches the four running agentbox-voice containers (CY-A2, `scripts/ci/check-declared-vs-running.js`). No other key moved. Relay ingress and its allowlist are untouched. `node scripts/agentbox-config-validate.js agentbox.toml` is valid (the same 5 advisory warnings as before). Decision and status unchanged.

## Re-verification — 2026-10-02 (`e020264b54c6872ca98995c1adda18b8451a39af`)

Tripped by ADR-2097 (the rail keyed by chain). `agentbox.toml` changes only inside `[payments.sidestr]` (ADR-2097): its comment block, `chain_id` now `sidestr:dreamlab-txbt4`, and `producer_url` dropped in favour of the chain's derived port. Nothing else this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff e434a7a59..e020264b54c6872ca98995c1adda18b8451a39af -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `agentbox.toml` gains only `[security].role_isolation = false` with its comment (ADR-2122); no other key moved. `AGENTBOX_ALLOWED_PUBKEYS` and the relay's no-fallback admission are byte-identical in both supervisor configs (`tests/config/role-isolation-supervisor.test.sh`). The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`d3ff8e9a876e6b026b543f8824487e002e04cfa0`)

Tripped by the G-5 Q15 correction (`custody/w8-key-split`). `agentbox.toml` changed only in the trailing comments of two allowlist entries: `b41654017f…2f7a` is relabelled as the operator's NIP-07 31403 decision signer (it is `[sovereign_mesh.operator].pubkey_hex`), not visionclaw-server, and the `11ed6422…663c` entry in `[interaction_plane.proxy]` notes that its Podkey-vault copy is to be replaced by K_browser. No key, value, table or list member moved. This record's claim at `:157-160` needs one correction and one confirmation. The correction: the entry it calls `visionclaw-server (governance publisher)` is the operator's decision signer. Q15 evidence, read from the dreamlab relay (every stored event of kinds 31400-31403) and from VisionClaw source: VisionClaw's 31402s are signed by `11ed6422…663c`, and `b41654017f…` signs only 31403. The confirmation: the ADR-040 D3 / G-5 key split has **not** landed, because no new pubkey is admitted yet, so `review_trigger` has not fired. The inline annotation now names G-5 rather than ADR-040 D3. `flake.nix` is untouched, so the baked allowlist is byte-identical. `node scripts/agentbox-config-validate.js agentbox.toml` is valid with the same 5 advisory warnings as `origin/main` (`0919dc39a`). Decision and status unchanged.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `agentbox.toml` changed only in the trailing comments of two allowlist entries (`d3ff8e9a8`, the Q15 correction: `b4165401` is the operator's decision signer). `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`).
The relay allowlist is unchanged: no allowlist entry was added or removed, and the relay still admits only listed pubkeys. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`32cedf9925ff6de8112fb45e41de048106d0d710`, custody integration CI fix)

Tripped by `32cedf992`, the fix for the PR's clippy and statix failures. `flake.nix` changes by one line in the `[sidechain.*]` normaliser: `parent = c.parent;` becomes `inherit (c) parent;` (statix W04), which evaluates to the same attribute set. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..32cedf992 -- <verified_paths>`.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `flake.nix` (`dc91e092a`) gains one let-binding, `roleIsolationBaked = securityCfg.role_isolation or false`, and its inline `/etc/sudoers` lines become a call to `config/bake-devuser-privilege.sh` with that flag; with the flag off (the shipped value) the baked `/etc/group`, `/etc/sudoers` and `/etc/sudoers.d/devuser` are byte-identical (RC-X1-07). Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 32cedf992..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `agentbox.toml` changes only in the comment above `[security].role_isolation = false`: it no longer says the identity port and the custody migration are absent, and names what is built (W3, W2b, W4) and what is owed (W3b). No key or value moves. The relay allowlist and its ingress are untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (vaultSrc repin)

`f93586b9e..33cbb29e8` changes one governed line: `flake.nix` `vaultSrc` moves from VisionClaw `64512141b` to main `94dc0ff60` (`33cbb29e8`, PR #13; ADR-2108 records why). Its one consumer is `lib/vault.nix` (the vault CLI package, `flake.nix:781`); nothing this record governs (ADR-2012 — Relay ingress is allowlist-only, no fallback, no auto-add) reads it. The decision holds. Re-verified by `git log f93586b9e..33cbb29e8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (poker house seat, PR #14)

`33cbb29e8..b41d9486c`: `agentbox.toml` gains `[poker_citizen]` (`enabled = true`, key and state under `sidestr/agents`, the forum relay, `daily_cap = 20000`) (`55b9fe9f6`); `flake.nix` bakes `nostr-bbs-poker-citizen` (`lib/poker-citizen.nix`) and a `[program:poker-citizen]` (`user=devuser`) only when `[sidechain].enabled` and `[poker_citizen].enabled`; it opens no listener: it dials the forum relay over `wss` and the local producer at `127.0.0.1:3450` (`55b9fe9f6`). The house seat is an outbound relay client, not an ingress path; the relay allowlist is untouched. The decision holds. Re-verified by `git log 33cbb29e8..b41d9486c -- <verified_paths>`.
