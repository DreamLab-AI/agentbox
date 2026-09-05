# Runtime profile and egress security

Status: proposed governing surface, 2026-09-04. Owner: agentbox maintainers. ADR-2026 and ADR-2027 previously referenced this absent file. This document records the inspected boundary and proposed acceptance requirements; it does not assert that the complete policies are implemented.

[ADR-2026](adr/ADR-2026-session-mirror-egress-boundary.md) governs session content egress. [ADR-2027](adr/ADR-2027-secret-custody-rotation-break-glass.md) proposes custody, rotation and revocation requirements; its provisional register below requires custodian confirmation and lifecycle evidence. [ADR-2007](adr/ADR-2007-profile-isolation.md) governs configuration separation, which does not establish an OS boundary.

Changes to profiles, keys, mirror providers, recipients, transport or diagnostics must identify their effect on these contracts and retain isolated failure/recovery evidence. Refer to secret identifiers and custodian roles, never secret values. Proposed policy remains subject to maintainer adoption.

## Runtime boundary qualification — 2026-09-04

ADR-2026 is now source-reviewed but remains proposed/partial/inactive for its complete egress policy. The live hook composes unredacted selected text before NIP-59 wrapping; the digest path sends flattened input to its configured summarisation provider and publishes a separately signed digest. Their configuration gates and encryption differ. A shared off/redaction/recipient/retention contract remains open, alongside ADR-2027 secret custody.

See the [estate review](../../../VisionFlow/docs/estate-review/runtime-egress-and-profiles.md) for isolated probes and current source scope. No live provider call, relay send or custody change is certified here.

## Provisional custody register — 2026-09-04

This register identifies credential roles and source-configured storage interfaces, not secret values or an attested production inventory. Every actual custodian, deployed location, rotation cadence and incident response time remains **unconfirmed**. Suggested responsibility below is a role to assign, not an assertion that someone has accepted custody. Do not copy secrets into this register.

| Credential role | Source/configuration interface | Suggested responsible role | Required rotation/revocation and acceptance evidence |
|---|---|---|---|
| Bridge identity / unwrap key | Bridge loads AGENTBOX_BRIDGE_SK_FILE, default /run/secrets/nostr.key; legacy environment fallback remains | Identity/runtime maintainers | Inventory every writer/reader and retained copy; replace key and identity references, reject old authority, test restart and failed persistence |
| Shared server publisher identity | ADR-2012 records pending per-consumer split; relay key list is build-projected | Publisher/relay maintainers | Identify each consumer, split keys, retire old authorisation at relay and inbox boundaries, prove old-key rejection after rebuild/deploy |
| Proxy break-glass bearer | NIP98_PROXY_ALLOW_BEARER captured at process start | Ingress incident owner | Implement expiry, request scope and auditable use; test expired/wrong-scope rejection and removal across all running instances |
| Proxy browser-session signing secret | NIP98_PROXY_SESSION_SECRET or per-boot random secret | Ingress/session maintainers | Define restart invalidation and multi-instance policy; verify old cookies fail after planned revocation and no secret enters audit logs |
| AoE daemon token | Daemon state file read by proxy with last-good cache | Runtime/session maintainers | Rotate daemon and proxy coherently; deleting the state file alone is insufficient; test cached token, direct access and rollback |
| Dream remote-execution identity | ssh/scp dispatch uses ambient SSH configuration; no explicit identity file in inspected calls | Evaluation/host maintainers | Establish actual identity and host authorisation separately; constrain remote capability, revoke and prove rejected access without disrupting unrelated credentials |
| Secret backup artefact and recovery access | VisionClaw scripts/backup-secrets.sh collects selected config names into workspace/secret-backups ZIP and manifest | Backup/recovery maintainers | Define protected storage, encryption/access keys, retention, off-host recovery and deletion; test restore and loss of recovery authority with synthetic inputs |

No cadence is invented here. Before adoption, each row needs an accepted custodian, exact deployed storage reference, rotation trigger/cadence, revocation procedure and maximum response window, plus a dated successful failure/recovery receipt. Provider credentials and other estate identities must be inventoried too; these seven rows are a starting set, not completeness certification.

The proxy's break-glass branch compares a configured token and returns a sentinel identity without expiry or request-scope checks there. It does not establish per-use durable audit. The backup script invokes ordinary zip and unzip integrity testing without encryption flags or explicit umask/chmod; final permissions depend on the invoking environment. Integrity testing is not a recovery exercise. The script was not run, and no backup contents were inspected. See the [estate evidence](../../../VisionFlow/docs/estate-review/runtime-ingress.md#custody-and-revocation-acceptance).


## Custody register update — 2026-09-05

Two of the seven rows below have moved from "recorded weakness" to "code with
tests behind it". The rest have not: **every custodian, deployed location,
rotation cadence and response window remains unconfirmed**, and drafting a row
still does not implement custody.

| Credential role | What changed on 2026-09-05 | Status |
|---|---|---|
| Proxy break-glass bearer | `verifyIdentity`'s break-glass branch gained **expiry** (`NIP98_PROXY_BEARER_EXPIRES_AT`, malformed value fail-closed), **request scope** (`NIP98_PROXY_BEARER_SCOPE`, `METHOD /prefix`, binding the method too) and **per-use audit** by sha256-12 token fingerprint on both acceptance and refusal. The health payload states `NO EXPIRY CONFIGURED` / `UNRESTRICTED` explicitly. 14 new self-test assertions against real proxy children; 134 total, 0 failures, 0 skips. | Bounds implemented, **default off**. A deployment that sets neither is exactly as unbounded as before — the status line now says so. Custodian unconfirmed; the counters are in-process, not a durable audit store. |
| Secret backup artefact and recovery access | Replaced the ordinary ZIP with `services/secret-backup`: **tar inside age**, using the maintained `age` crate (X25519 / scrypt, ChaCha20-Poly1305 under STREAM). It **cannot** write a plaintext archive — with no recipient and no passphrase the run fails having created no file. Archive and manifest are `0600`; the manifest carries names only; restore refuses path traversal. **Recovery exercised on synthetic data**: backed up and restored byte for byte, with the archive verified to contain none of the plaintext. 7 cargo tests pass. | Encryption and a **demonstrated restore** implemented. Off-host survival, retention, deletion and revocation of retained copies remain untested. Not yet wired into `flake.nix`, so the image does not ship the binary. |
| Bridge identity / unwrap key | unchanged | Unconfirmed |
| Shared server publisher identity | unchanged; the ADR-2012 relay/inbox split remains pending | Unconfirmed |
| Proxy browser-session signing secret | unchanged | Unconfirmed |
| AoE daemon token | unchanged | Unconfirmed |
| Dream remote-execution identity | unchanged | Unconfirmed |

No cadence has been invented. Before adoption each row still needs an accepted
custodian, an exact deployed storage reference, a rotation trigger and cadence, a
revocation procedure, a maximum response window, and a dated failure/recovery
receipt. Seven rows remain a starting set, not a completeness certification.

Evidence: [ADR-2027 receipt](estate-closeout/2026-09-05/adr-2027-custody-break-glass.json).

## Egress policy adoption — 2026-09-05

ADR-2026's shared content-egress contract now exists as an artefact rather than a
requirement: [`config/egress-policy.json`](../config/egress-policy.json)
enumerates content, recipients, providers, encryption, transport and log
retention **per path**, and both runtimes implement it —
`config/hooks/lib/egress-policy.cjs` for the live mirror and
`services/nostr-pod-bridge/src/egress_policy.rs` for the digest — held together
by a paired redaction fixture both must satisfy in their own test suites.

The three properties the earlier qualification called open are now closed in
code: **redaction happens before egress** on both paths (before the NIP-59 wrap;
before the provider request is built), a **single `AGENTBOX_EGRESS` switch**
disables every path, and **`skipped` / `attempted` / `accepted` / `failed`** are
distinguishable — `publishWrap` previously resolved with nothing on relay-OK,
rejection, error, close and timeout alike, which is why exit zero could not prove
delivery. Verified with network-denial fixtures that make delivery impossible.

Still open: no real transcript, provider call or relay send was exercised; the
relay/read policy for the signed kind-30840 digest is a separate boundary; and
the policy document remains **proposed** pending maintainer adoption.
