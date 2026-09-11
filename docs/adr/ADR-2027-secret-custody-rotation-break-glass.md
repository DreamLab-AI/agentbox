---
id: ADR-2027
title: "Secret custody, rotation, and break-glass lifecycle"
date: 2026-08-31
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 8fcc7b79b7c93c0744ca68b7a09fa14fdae8f5e3
verified_paths: [lib/secret-backup.nix, flake.nix, services/secret-backup/src/main.rs, services/secret-backup/Cargo.lock]
owner: jjohare
review_trigger: introduction or rotation of any load-bearing secret; compromise incident
repo: agentbox
domain: SECURITY-profiles
---

# ADR-2027 — Secret custody, rotation, and break-glass lifecycle

## Context

Panel finding P1-5: at least five load-bearing secrets are implied across the
estate and none has a recorded custodian, rotation cadence, or revocation path.
They are: the visionclaw bridge key (visionclaw ADR-2013); the "currently
shared" visionclaw-server publisher key, whose per-consumer split is explicitly
pending (agentbox ADR-2012); the break-glass bearer (agentbox ADR-2009/2010) —
the only credential surviving verifier failure and the least governed, i.e. an
ungoverned master; the dream-dispatch SSH credential to `${CONNECTED_NODE_SSH}`
(agentbox ADR-2024); and `backup-secrets.sh` (visionclaw ADR-2017). The relay
allowlist in agentbox ADR-2012 is baked at nix build, so publisher revocation
needs a full rebuild — the compromise window is one build-deploy cycle.

## Decision

Each load-bearing secret MUST have a recorded custodian, storage location,
rotation cadence, and revocation path. Break-glass bearers MUST be short-lived,
single-scoped, and audit-logged on every use — no bearer functions as a standing
master credential. The shared visionclaw-server publisher key MUST be split per
consumer (the pending ADR-040 D3 split). Rotation of a build-baked allowlist
entry MUST be documented as requiring a full rebuild until the allowlist is moved
to runtime config, and that rebuild-bound compromise window is recorded against
the secret.

## Consequences

- The five implied secrets become governed: each gains an owner, a rotation
  cadence, and a revocation path, so a compromise has a bounded, documented
  response rather than an ad-hoc scramble.
- The break-glass path stops being an ungoverned master credential — short-lived,
  single-scoped, audit-logged use makes its exercise witnessed and its blast
  radius small.
- Cost/follow-on: the publisher key-split (ADR-040 D3) must land before the shared
  key is retired; until the ADR-2012 allowlist moves to runtime config, publisher
  revocation still costs a rebuild cycle, which this record makes explicit rather
  than removing.

## Verification

None yet — this record is `proposed`/`none`/`inactive`. Verification lands when
the custody register exists, the publisher key-split ships, and break-glass use is
audit-logged; at that point set `verified_commit` and populate `verified_paths`.
Governing surface: `docs/SECURITY-profiles.md`.

## Closeout extension — 2026-09-04

CP-01/04/07/08. Owner remains jjohare; actual custodians are not yet confirmed. The [provisional register](../SECURITY-profiles.md#provisional-custody-register--2026-09-04) now identifies seven credential roles, source interfaces and required evidence. Proposed/none/inactive is retained for the complete lifecycle policy: drafting rows does not implement custody, rotation or bounded break-glass authority.

Source review finds a static break-glass token comparison without branch-local expiry/scope checks; SSH dispatch depends on ambient client configuration; secret backup uses an ordinary ZIP and archive-integrity test. Those are not lifecycle guarantees. Publisher removal must account for the relay/inbox distinction now recorded in ADR-2012; one rebuild alone is not a demonstrated revocation bound.

**Acceptance condition:** Confirm custodians and deployed storage without recording values, enumerate remaining provider/service credentials, define rotation and incident windows, and test revoked/expired/wrong-scope rejection across running instances, caches, retained backups and restart. Establish durable use receipts without credential leakage. Test encrypted/protected backup recovery using synthetic data. Coordinate publisher key-split and session/daemon invalidation; preserve explicit evidence for failed persistence and failed rotation. See the [review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-ingress.md#custody-and-revocation-acceptance) and [source receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/custody-snapshot.json). No real credential was read, rotated or used.

## Acceptance progress — 2026-09-05

**Implemented — break-glass is bounded authority.** The review found "a static
break-glass token comparison without branch-local expiry/scope checks", and that
returning a mode/identity "is not durable per-use audit". A credential that never
expires, reaches every route and leaves no record is indistinguishable from a
permanent backdoor with a dramatic name. Three bounds now sit inside the
break-glass branch itself, applied *after* the constant-time token compare:

* **Expiry** — `NIP98_PROXY_BEARER_EXPIRES_AT` (ISO-8601 or epoch seconds). A
  *malformed* value is fail-closed: an operator who tried to bound the credential
  and mistyped must not silently receive an unbounded one.
* **Request scope** — `NIP98_PROXY_BEARER_SCOPE`, comma-separated
  `METHOD /path/prefix` entries. The correct token outside its scope is refused,
  and the scope binds the method as well as the path.
* **Auditable use** — every acceptance *and* every refusal is logged with a
  sha256-12 token **fingerprint**, never the token, plus method, path, remote
  address and a use counter. That lets uses of one credential be correlated
  across a rotation without the audit log becoming a second place the secret
  lives.

The health payload reports `NO EXPIRY CONFIGURED` and `UNRESTRICTED` explicitly,
so an unbounded credential cannot read as a bounded one on a status page, and the
in-process counters are labelled as *not* a durable audit store. Both bounds
default off, so an existing deployment is byte-compatible until an operator sets
them — the credential is no weaker than before and materially stronger the moment
either is configured.

**Implemented — the backup is encrypted, and recovery has been exercised.** The
review found an ordinary ZIP with an `unzip -t` check, "neither encryption nor
explicit permission hardening", and noted that "archive integrity does not
establish restoration". `services/secret-backup` replaces it with **tar inside
age** — both established formats with maintained implementations; the `age` crate
is the reference Rust implementation of the age specification (X25519 or scrypt
key wrapping, ChaCha20-Poly1305 under STREAM). No primitive is implemented here
and there is no bespoke envelope. The hard rule is that it **cannot produce a
plaintext archive**: recipients are resolved before anything is read, and with
neither a recipient nor a passphrase the run fails having created no output file.
Archive and manifest are written `0600`; the manifest carries file *names* only;
restore refuses any entry path that could escape its destination.

**Tests and results.** `config/nip98-proxy/selftest.mjs` — **134 assertions, 0
failures, 0 skips** (the post-merge number across this change and the concurrent
ADR-2009/2010 work in the same files); 14 of those are the new section-N cases,
run against real proxy children on ports 19102–19104, covering expired-but-valid
token, in-scope acceptance, out-of-scope refusal, method binding, the fingerprint
audit on both outcomes, the absence of the token from every audit record, the
malformed-expiry fail-closed path, and back-compatibility when neither bound is
set. `services/secret-backup` — **7 cargo tests pass**, including the synthetic
recovery exercise the acceptance condition names: invented secrets are backed up,
the archive is verified to be an age file containing none of the plaintext, and
they are restored **byte for byte** into a different directory. The same exercise
is available on demand as `agentbox-secret-backup self-test`. A recipient-based
round trip with a real x25519 keypair is covered separately.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2027-custody-break-glass.json`.

**Governed paths changed.** `config/nip98-proxy/proxy.mjs` (break-glass branch,
new env constants, health payload), `config/nip98-proxy/selftest.mjs` (section N
appended), `services/secret-backup/` (new crate),
`docs/SECURITY-profiles.md` (custody register).

**Remaining — and this is most of the ADR.** Custodians are still
**unconfirmed**: the register records roles to assign, not accepted custody. No
rotation was performed and no credential revoked; rotation cadences and incident
windows remain undefined. The in-process use counters are not a durable audit
store — a restart resets them. Off-host survival and revocation of retained
backup copies are untested: an encrypted archive is not a retention or
destruction policy. The publisher key-split (ADR-2012) and session/daemon
invalidation are untouched. The new crate is not yet wired into `flake.nix`, so
the image does not ship the binary. `implementation_status` stays `none` for the
full lifecycle policy; what has moved is that two of its concrete weaknesses —
unbounded break-glass authority and a plaintext backup — now have code and tests
behind them.


## Packaging implementation — 2026-09-07 (G-17)

`lib/secret-backup.nix` now builds the locked standalone crate with checks enabled;
`flake.nix::secretBackupPkg` includes the operator-invoked binary in the runtime
package list. Seven isolated Rust custody tests pass. This does not perform a
publisher-key split, rotate a credential or demonstrate a loaded runtime closure.
The earlier unwired-build statement is historical; final Nix build and deployment
validation remain separate acceptance evidence.

The source verification anchor for this execution is `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; it does not identify the loaded container.

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

### 2026-09-07 Nix custody build and ancestor regression

The actual the connected node Nix build exposed an absolute-path pruning defect: a requested
backup tree beneath `/build` was skipped entirely. `collect` now applies directory
exclusions to paths relative to the requested root. The new ancestor regression
retains nested build-directory exclusion while including the root secret fixture.
All eight synthetic tests pass both locally and in the pinned Nix derivation,
which installs `agentbox-secret-backup`. This verifies the standalone package,
not deployment of the runtime image or recovery of real credentials. No real
secret material was read or rotated. Source: `e7bfc158a45bf97061fd6e7202e9ee053aa1f765`.

### 2026-09-07 development-shell re-verification

The only intervening governed flake change selects the upstream executable
`nix2container.packages.${system}.nix2container-bin` for devShell buildInputs;
the former `n2c.nix2container` attribute does not exist. The selected executable
derivation evaluates on the pinned the connected node input. Container package selection,
admission and custody behaviour are unchanged by this development-shell repair.
Existing runtime activation limits remain. Verification is renewed at
`8fcc7b79b7c93c0744ca68b7a09fa14fdae8f5e3`; the project flake.lock has not been updated.
