---
id: ADR-2122
title: Role service accounts, /run/secrets, and the identity port
date: 2026-10-03
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 055c06ff69b2f53bf38a67d254c048bb03599fc8
verified_paths: [config/role-accounts.json, config/custody/identity-port-acl.json, services/nostr-pod-bridge/src/identity_port/mod.rs, services/nostr-pod-bridge/src/identity_port/server.rs, management-api/lib/pod-signer.js, scripts/activation/role-isolation-rehearsal.sh, scripts/activation/role-isolation-rehearsal.host.sh, tests/config/role-isolation-rehearsal.test.sh, services/agentbox-manifest/src/role_accounts.rs, services/agentbox-manifest/src/main.rs, lib/agentbox-manifest.nix, config/lib/role-custody.sh, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, tests/config/role-isolation-supervisor.test.sh, tests/config/role-secrets-delivery.test.sh, tests/config/role-isolation-boot.test.sh, tests/config/fixtures/role-isolation/supervisord.conf]
owner: jjohare
review_trigger: the role-isolation rehearsal (scripts/activation/role-isolation-rehearsal.sh) passing or failing on a rebuilt image; a new secret-bearing supervisor program; a new [sidechain.<name>] chain; a change to the host docker gid; the identity port's consumer cutover (W3b: JunkieJarvis, the mirror hook, the gateway, dream-engine); a change to config/custody/identity-port-acl.json
repo: agentbox
domain: SECURITY-profiles
lineage: ADR-2027 (secret custody; role accounts become its custodians, owner Q3), ADR-2101 (named operations only, no generic sign port), ADR-2078 (pods signer source moves to the port under the flag), ADR-2066 (pod signing key path), ADR-2064 (fail-closed signing preserved), ADR-2020 (gated, identical in effect when off), ADR-039 (apply classes)
---

# ADR-2122 — Role service accounts, /run/secrets, and the identity port

## Context

Every secret in this container reaches every process. `.env` feeds PID 1's environment and
supervisord passes it to every child. The sovereign key sits in a devuser file at
`/run/secrets/nostr.key`. Producer keys, parent credentials and treasury keys are devuser-owned
on the secrets volume or the workspace bind. `/run/secrets` is a directory on a `/run` tmpfs
that devuser owns, so devuser can rename it. Same-uid enforcement in the colloquy publisher is
described in its own source as "discipline, not enforcement". The custody design for swarm
`custody-isolation-2026-10-03` (X-1 step 1) sets out why, with evidence, in its §1.

Three bypasses made any in-container boundary void. Workstream W0 closed them (branch
`custody/w0-bypasses`, tests RC-X1-01..05). It made the root boot `PATH` store-only and Stage B
one-shot, took devuser out of group root, and gated the Docker socket behind the flag with a
GET-only read proxy for devuser.

## Decision

One Unix account per secret-holding role, baked into the image, and one flag that switches the
supervised programs onto them at boot.

### 1. Accounts (design §2.2)

`config/role-accounts.json` is the single source. `flake.nix` appends its passwd and group lines
(`agentbox-manifest role-accounts passwd|group`). It also ships the table at
`/etc/agentbox/role-accounts.json`. Range 960–979. uid = gid. Each role has its own primary group
with **no members**. devuser joins no role group, and no role is in group root or devuser.
Home is `/run/secrets/<role>/home`. Shell is `/sbin/nologin`.

| Role | uid | Programs (isolated config) | Secrets delivered to `/run/secrets/<role>/` |
|---|---|---|---|
| `ab-identity` | 960 | `nostr-relay` | `nostr.key` ← `$AGENTBOX_BRIDGE_SK`; `AGENTBOX_PRIVKEY_HEX`, `AGENTBOX_NSEC`, `JUNKIEJARVIS_PRIVKEY_HEX`, `CONCIERGE_PRIVKEY_HEX` ← the same-named PID-1 variables |
| `ab-gateway` | 961 | `nostr-gateway` | none (signs through the port; AoE bearer through the share, design §2.6) |
| `ab-ingress` | 962 | `nip98-proxy` | `NIP98_PROXY_ALLOW_BEARER`, `NIP98_PROXY_SESSION_SECRET` ← PID-1 variables |
| `ab-spend` | 963 | — (Q6: W5 deferred) | none in step 1; account only |
| `ab-sidestr-dreamlab` | 964 | `sidestr-producer` | `signer.key` ← `secrets/sidestr-dreamlab.key`; `parent.credential` ← `secrets/sidestr-tbtc4.cookie` |
| `ab-faucet-dreamlab` | **966** | `sidestr-faucet` | `treasury.key` ← the program's `SIDESTR_FAUCET_KEY` (`[sidechain].faucet_key_file`) |
| `ab-sidestr-dreamlab-txbt4` | 967 | `sidestr-producer-dreamlab-txbt4` | `signer.key` ← `secrets/sidestr-dreamlab-txbt4.key`; `parent.credential` ← the program's `SIDESTR_PARENT_COOKIE` (`parent_credential_file`) |
| `ab-faucet-dreamlab-txbt4` | 968 | `sidestr-faucet-dreamlab-txbt4` | `treasury.key` ← the program's `SIDESTR_FAUCET_KEY` |

**965 is reserved.** It is the host docker group that `docker-compose.override.yml` adds through
`group_add`. A role whose gid is 965 would be in the Docker socket's group, and the Docker daemon
is root on the host. The design's "per chain from 964 upwards" would have put
`ab-faucet-dreamlab` exactly there. The table validator refuses any reserved id, and a test
cross-checks every compose `group_add` gid.

management-api, dream-engine and the agent plane (aoe, tmux) stay devuser, as the design's §1
inventory decides. JunkieJarvis is a key in `ab-identity`'s keyring, not an account.

### 2. Two supervisor configs, one flag (design §2.3, §3.1)

`/etc/supervisord.roles.conf` is a pure function of today's rendered `/etc/supervisord.conf`
(`agentbox-manifest role-accounts isolate`). In each role program it changes exactly two lines:

- `user=devuser` becomes `user=<role>`;
- `environment=` gains or rewrites `HOME`, `AGENTBOX_SECRETS_DIR` and each secret's path variable
  (`AGENTBOX_BRIDGE_SK_FILE`, `SIDESTR_KEY`, `SIDESTR_PARENT_COOKIE`, `SIDESTR_FAUCET_KEY`), all
  pointed at `/run/secrets/<role>/`.

A secret's at-rest source is the program's own `environment=` value when it sets the variable, so
manifest paths are never duplicated. The same run emits the delivery plan
`/etc/agentbox/role-secrets.tsv`. The build fails if a secret-bearing program has no role, if a
role program is not `user=devuser` today, or if a source is not a literal path.

`[security].role_isolation` (default `false`) is **boot-class**. Accounts, both configs, the plan
and the mount ship in every image, and the entrypoint picks at its final `exec`. The image that
first carries this change needs one rebuild.

### 3. Secret delivery (design §2.4)

`/run/secrets` is its own tmpfs (`mode=711,uid=0,gid=0,noexec,nosuid,nodev`) in both modes, so
devuser cannot rename it. With the flag on, the entrypoint's root phase does four things:

1. Keeps the mount `root:root 0711` and records `degraded:secrets-mount` if it is not a mount
   point.
2. Moves W0's Stage-B guard to `/run/secrets/.root-guard`. With the flag off the guard stays in
   `/tmp/.agentbox-root`, because the flag-off boot hands `/run/secrets` to devuser.
3. Just before `exec`, runs the plan (`config/lib/role-custody.sh`, `ab_role_secrets_deliver`):
   `<role>/` at `0500`, `<role>/home` at `0700`, each file at `0400`, all owned by the role.
   File sources are copied only if they are regular, non-symlinked and at most 64 KiB.
   Classified variables are written through the `printf` builtin and then **unset**, so
   supervisord never inherits them.
4. Writes `ok:` or `degraded:secrets-delivery` to `/run/secrets/role-isolation.state`.

Phase 5c writes no devuser `nostr.key`. No value is printed or put on argv. Every failure is
logged with a `ROLE-ISOLATION-` marker and the boot continues: a role whose secret is missing
fails closed under supervisord. An image that cannot honour the flag boots as flag-off and logs
`ROLE-ISOLATION-UNAVAILABLE`.

### 4. The identity port (design §2.5) — decided here, built by W3a

`nostr-pod-bridge`, running as `ab-identity`, becomes the only holder of the sovereign, operator,
per-agent DID and JunkieJarvis keys. It serves a unix socket under `/run/secrets/port/` that
authorises callers by `SO_PEERCRED` uid. It offers a closed set of named operations and never a
generic `sign(event)` (ADR-2101). The set W3 built, the socket's final location
(`/run/secrets/ab-identity-port/identity.sock`) and its group are recorded under
"The identity port as built (W3) — 2026-10-03" below. Each decision gets a
content-free receipt. The crypto stays in `nostr-bbs-core` and `k256`. No new key format, event
kind or published crate is introduced.

### Invariants

| Boundary | Invariant |
|---|---|
| `ab-identity` + port | No process other than `nostr-pod-bridge` holds the sovereign, operator, per-agent or JunkieJarvis secret. Every signature is a named, uid-admitted, receipted operation. |
| `ab-sidestr-<chain>` | A chain's signer key and parent credential are readable only by its producer. |
| `ab-faucet-<chain>`, `ab-spend` | Value-bearing keys are reachable only by the process that enforces the spend policy. |
| `ab-ingress` | The LAN-door break-glass credential cannot be lifted by a co-resident agent. |
| `/run/secrets` mount | Only root creates, replaces or renames secret paths after boot. |
| devuser ∉ {root, docker, any role} | devuser cannot reach a credential by becoming root, in the container or on the host. |

## Acceptance

The decision is accepted when `scripts/activation/role-isolation-rehearsal.sh` (W6a, branch
`custody/w6a-rehearsal`) and its host half pass on a rebuilt image with the flag on, checks
(a)–(f) of design §4, and land a receipt under `docs/estate-closeout/<date>/`.
`degraded:docker-socket` and `degraded:secrets-*` are failures. `activation_status` moves only
on that receipt. Peer agent messages are not approval.

## Status: what exists and what is owed

**Built (W0 + W1 + W3, staged, unverified in an image).**

- The three bypasses are closed (W0).
- The accounts, the mount, the derived isolated config and plan, the delivery and the flag
  wiring are in place (W1).
- The identity port and the pods signer's cutover to it (W3; see the dated section below).
- With the flag off the boot is today's. `tests/config/role-isolation-boot.test.sh` executes the
  real entrypoint blocks and shows `exec supervisord -c /etc/supervisord.conf`, no delivery and no
  state write.

**Owed before the flag may be turned on.** Under the flag today, role programs fail closed.

- **W2 custody.** It locks the at-rest volumes (`secrets/` and `identities/` to `root 0700`,
  files to `0400`), with an idempotent migrate/revert. **Until W2, devuser can still read the
  at-rest copies in `/var/lib/agentbox/secrets` and the workspace treasury keys**, so the flag
  gives no confidentiality on its own.
- **W2 other items.**
  - A public-only `identity.env`.
  - The aoe-share copy for `ab-gateway` and `ab-ingress`. Both still point at devuser's
    `serve.url`.
  - Ownership of the relay data dir `/var/lib/nostr-relay` for `ab-identity`.
  - The `role-exec` launcher: environment clear, store-only `PATH`, umask 077. It will change
    role programs' `command=` lines, and the drift test's allowed set must widen to `command=`
    explicitly when it lands.
- **W3b.** The rest of the consumer cutover: JunkieJarvis, the mirror hook, the gateway and
  dream-engine. The pods signer moved in W3.
- **Readers of the delivered files.**
  - `nip98-proxy` reads `NIP98_PROXY_ALLOW_BEARER` and `NIP98_PROXY_SESSION_SECRET` from its
    environment only. Under the flag break-glass is off and sessions use a per-boot secret: fail
    closed.
  - The gateway reads `AGENTBOX_PRIVKEY_HEX` from its environment only.
- **W4.** The sidestr upstream baked from Nix. As `ab-sidestr-*`, git refuses the devuser-owned
  workspace checkouts. W4 also moves the state off the workspace and creates the
  `ab-sidestr-read` group.

### Deviations from the design, with reasons

- **The isolated config was first built as `supervisord.isolated.conf`**, per the lead's brief.
  At integration (2026-10-03) it was renamed to the design's `/etc/supervisord.roles.conf`, the
  name W6a's rehearsal probes (queen's disposition, design §13).
- **Role homes are under `/run/secrets/<role>/home`**, not `/var/lib/agentbox/home/<role>`.
  devuser owns `/var/lib/agentbox` (Phase 1 chowns it), so it could rename a home placed there.
- **uid 965 is skipped**, as described under §1.
- **There is no `role-exec` wrapper yet.** The contract that only `user=` and `environment=`
  differ is what makes this step reviewable.
- **The `ab-sidestr-read` and `ab-aoe-share` groups are not created.** Their consumers are W4
  and W2, and devuser joins no group in this step.
- **The catalogue apply class is `boot`, not `rebuild`.** The flag does not change the image's
  composition (ADR-039's definitions).

### Recorded facts

- `11ed64…` keeps read access to the forum's epoch-1 zone secrets. It cannot be undone. Re-sealing
  is a named follow-up (queen's disposition on Q16).
- `[program:tailscale-up]` passes `TAILSCALE_AUTHKEY` on argv (pre-existing, root program). It is
  not classified in this step because the scrub would remove its only source. It belongs to the
  design's root-only delivery and is a finding for W2.
- `[program:docker-read-proxy]` (W0) carries a TODO to move into this registry. It needs no
  account: it holds no secret and must start as root to join the socket's group before dropping to
  65534. The comment is left in the supervisor text so that today's config stays byte-identical,
  and it goes at the next edit of that block.

## The identity port as built (W3) — 2026-10-03

Folded in at integration from `custody/w3-identity-port` (`a44ea413f`, `9e87ae402`, `26fc543d2`,
`57ea350a9`). It narrows §4 and does not widen it.

- **Program.** `nostr-pod-bridge serve-identity`, `[program:serve-identity]` in today's config as
  `devuser`. With the flag off it prints one line and exits 0, like `docker-read-proxy`. With the
  flag on, `role-accounts isolate` runs it as `ab-identity`. `env -i` passes only the flag, the
  ACL path, the key dir (`AGENTBOX_SECRETS_DIR`, i.e. `/run/secrets/ab-identity`), the socket path
  and gid, and the receipt dir, so PID 1's inherited `.env` never reaches it.
- **Operations** (`acl.rs` `OPERATIONS`, closed): `pubkey`, `nip98` (URL-prefix allowlist),
  `sign_event` (granted kinds only), `forum_event`, `nip42_auth` (allowlisted relays) and
  `mirror_key`. Kinds 27235, 22242, 31400–31405 and 38414 cannot be granted through `sign_event`;
  the loader refuses such an ACL. Zone sealing is not an operation. `dm_unwrap` stays inside the
  relay process and is refused at the port.
- **Authorisation.** `config/custody/identity-port-acl.json`, keyed by `SO_PEERCRED` uid: devuser
  (1000) and `ab-gateway` (961). The socket's group only narrows who can connect.
- **Keys.** `core` is the file `AGENTBOX_PRIVKEY_HEX` and `junkiejarvis` is
  `JUNKIEJARVIS_PRIVKEY_HEX`, both in `/run/secrets/ab-identity/` as W1's plan writes them (byte
  for byte; the live-mirror child derives from the supplied hex, `src/mirror_key.rs`). W3 first
  named them `core.key` and `junkiejarvis.key` under `/run/secrets/identity/`. Integration kept
  W1's names because W2's readers resolve `$AGENTBOX_SECRETS_DIR/<VAR>`.
- **Socket.** `/run/secrets/ab-identity-port/identity.sock`, 0660, group `ab-identity-port` (969).
  The directory is `ab-identity:ab-identity-port 0750`. W1's delivery creates it from a `sockdir`
  plan row inside the root-owned secrets mount. `serve-identity` refuses a parent that is
  world-writable without the sticky bit, or one owned by neither root nor itself.
- **Receipts.** One content-free JSONL line per decision under `/var/lib/agentbox/events/sign/`
  (`ab-identity:devuser 2750`, from a `dir` plan row; the port cannot create it under the
  devuser-owned parent).
- **Consumer.** `management-api/lib/pod-signer.js` signs pods NIP-98 through `sign-request nip98`
  when the flag is on (or `sign_source = "identity-port"`). Then the port is the only source, and
  a refusal, an absent port or a failure to answer becomes `SigningUnavailable` before a byte is
  sent (ADR-2064 unchanged).

## Integration resolutions — 2026-10-03

Applied on `custody/integration` under the queen's dispositions (design §13). Each one is its
own commit with the reason.

- **One supervisor config name.** `/etc/supervisord.roles.conf` everywhere: the flake,
  `role_accounts.rs`, the entrypoint and W1's tests.
- **One role table.** The rehearsal (both halves) reads `/etc/agentbox/role-accounts.json` in
  this record's schema together with `role-secrets.tsv`. Its derived numbering is gone, because it
  put a faucet at 965, the host docker gid. A missing table, a missing plan or any role uid in
  `reserved_ids` exits 1.
- **The socket group comes from the table.** `config/role-accounts.json` gains `groups`
  (`ab-identity-port`, gid 969, members devuser, `ab-identity` and `ab-gateway`; the owner is a
  member because chgrp needs membership) and `dirs`. `isolate` exports
  `AGENTBOX_IDENTITY_SOCK_GID` to `ab-identity`'s programs, and the plan gains `sockdir` and `dir`
  rows. Role groups still have no members.
- **Deviation: the socket is not under `/run/agentbox`.** The disposition asked for a root-owned
  `/run/agentbox`. `/run` is a devuser-owned tmpfs, so devuser could rename a root-owned
  `/run/agentbox` away and plant a socket. That is the reason `/run/secrets` has its own mount
  (§"Deviations"). Root-owning it would also break `bootstrap-seal` (`bootstrap.done`, the
  `/ready` signal) and `teammate-gc` under the flag. The socket therefore sits inside the
  `/run/secrets` mount.

## Consequences

- The image gains 8 passwd and 9 group lines (8 role groups and `ab-identity-port`), `/etc/supervisord.roles.conf`,
  `/etc/agentbox/role-secrets.tsv`, `/etc/agentbox/role-accounts.json` and an 8 MiB tmpfs. With
  the flag off it behaves as before. In ADR-2020's terms, it is identical in effect but not
  identical in bytes. One thing changes in both modes: `/run/secrets` becomes a mount point that
  devuser cannot rename.
- A new chain or a new secret-bearing program cannot ship without a role. The build names the fix.
- Operators lose `cat`-level access to role secrets under the flag. Rotation and backup move to
  `docker exec -u 0` from the host shell.

## Verification

At `055c06ff6`. Nix cannot be evaluated in this container. Neither the image, the compose mount
nor a boot has been exercised.

- `cargo test` in `services/agentbox-manifest`: 161 passed, including 12 `role_accounts` tests.
- `tests/config/role-isolation-supervisor.test.sh` (20): on a real rendered config, the two
  configs differ only in the 7 role programs' `user=` and `environment=` lines (14 lines), and the
  31 other programs are byte-identical. No program names another role's secret path. No at-rest
  source or planted secret value survives. An unmapped secret-bearing program fails the build. The
  docker gid is reserved.
- `tests/config/role-secrets-delivery.test.sh` (26): the real plan against a scratch root. Owners
  come from a chown ledger because no root or user namespace is available. It checks modes,
  contents, the environment scrub, idempotence, hostile sources and hostile plan rows.
- `tests/config/role-isolation-boot.test.sh` (22): the entrypoint blocks executed with stubs for
  the flag off, the flag on, an unavailable image and a degraded mount. Two mutations of the gate
  were caught.
- W0's `RC-X1-01..05` (50 + 6), the five entrypoint-parsing suites,
  `scripts/ci/check-secret-not-in-env.sh`, `agentbox-config-validate.js` (both manifests) and
  `check-manifest-catalogue.js` pass.

**The owner's rebuild must show** (`./agentbox.sh rebuild`, host tab 6, then flag still off):

- `getent passwd ab-identity` gives `960`.
- `findmnt /run/secrets` is a tmpfs.
- `/etc/supervisord.roles.conf` and `/etc/agentbox/role-secrets.tsv` exist.
- `supervisorctl status` matches the pre-rebuild set.
- `/run/secrets` is `devuser 0700`, and `nostr.key` is present as before.
