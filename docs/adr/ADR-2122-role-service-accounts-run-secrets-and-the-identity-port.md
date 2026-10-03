---
id: ADR-2122
title: Role service accounts, /run/secrets, and the identity port
date: 2026-10-03
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 275e12356319a9630846656580d497d53de3d38c
verified_paths: [config/role-accounts.json, services/agentbox-manifest/src/role_accounts.rs, services/agentbox-manifest/src/main.rs, lib/agentbox-manifest.nix, config/lib/role-custody.sh, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, tests/config/role-isolation-supervisor.test.sh, tests/config/role-secrets-delivery.test.sh, tests/config/role-isolation-boot.test.sh, tests/config/fixtures/role-isolation/supervisord.conf, config/custody/env-classes.json, scripts/ci/env-secret-inventory.js, management-api/lib/role-secret.js, services/nostr-pod-bridge/src/role_secret.rs, services/nostr-pod-bridge/src/bootstrap.rs, tests/runtime-contract/RC-X1-06.sh]
owner: jjohare
review_trigger: the role-isolation rehearsal (scripts/activation/role-isolation-rehearsal.sh) passing or failing on a rebuilt image; a new secret-bearing supervisor program; a new [sidechain.<name>] chain; a change to the host docker gid; the identity port (W3a) landing
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

`/etc/supervisord.isolated.conf` is a pure function of today's rendered `/etc/supervisord.conf`
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
authorises callers by `SO_PEERCRED` uid. It offers a closed set of named operations (`pubkey`,
`nip98`, `publish_colloquy`, `mirror_wrap`, `digest_sign`, `forum_event`, `zone_open`,
`nip42_auth`, `dm_unwrap`) and never a generic `sign(event)` (ADR-2101). Each decision gets a
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

### 3a. The environment scrub (W2, bypass 3) — added 2026-10-03

compose `env_file` puts `.env` into PID 1 and supervisord hands its environment to every
child, so delivery to files is not enough on its own: the variables must also leave PID 1.
The ROLE set is a checked-in table, `config/custody/env-classes.json`. Every environment
variable name that the entrypoint, `config/lib/role-custody.sh`, `flake.nix`, the compose files,
management-api and the role-secret consumers read is in exactly one class:

- **ROLE (11):** `AGENTBOX_PRIVKEY_HEX`, `AGENTBOX_NSEC`, `AGENTBOX_BRIDGE_SK`,
  `OPERATOR_NOSTR_PRIVKEY`, `JUNKIEJARVIS_PRIVKEY_HEX`, `CONCIERGE_PRIVKEY_HEX`,
  `AGENTBOX_AGENT_PRIVKEY_HEX` and `AGENT_PRIVKEY_HEX` (all `ab-identity`);
  `NIP98_PROXY_ALLOW_BEARER` and `NIP98_PROXY_SESSION_SECRET` (`ab-ingress`);
  `TAILSCALE_AUTHKEY` (`root`).
- **DEVUSER_CLASS (35):** accepted exceptions, each with a reason. These are the Q8 provider
  and devuser credentials, `BRIDGE_TOKEN`, `MANAGEMENT_API_KEY` and `VAULT_NOSTR_SECRET`
  (a ROLE candidate for W3b).
- **NON_SECRET:** everything else. A credential-shaped name needs an exact entry.

`scripts/ci/env-secret-inventory.js --check` fails on any of the following:

- an unclassified name;
- a name in two classes;
- a secret-shaped name classified by pattern;
- drift between the ROLE set and the entrypoint's `_AB_ROLE_ENV_VARS`;
- drift from this record's `config/role-accounts.json`. Every `from_env` there is ROLE with the
  same role, and the four ROLE vars the plan lacks are listed as `w2_only`.

Under the flag, the entrypoint does three things:

1. **`_ab_role_env_capture` runs before the identity bootstrap.** Each ROLE variable present is
   written to `/run/secrets/<role>/<NAME>` at `0400` (the same artefact §3's plan writes). Its
   `<NAME>_FILE` is exported and the variable is unset. It runs this early because under the flag
   the bootstrap must not read a bare operator pin. §3's `env` rows then find these variables
   already unset and skip them.
2. **`identity.env` is public-only.** It carries no `AGENTBOX_NSEC` and no
   `AGENTBOX_BRIDGE_SK`. The bootstrap writes the relay key itself to
   `/run/secrets/ab-identity/nostr.key` (`create_new`, `0400`). The secret otherwise lives only
   in the identity file.
3. **`_ab_role_env_scrub` runs on the line before `exec`.** It unsets anything re-exported since
   and logs `ROLE-ISOLATION-LEAK <NAME>`.

Readers use one loader per language: `management-api/lib/role-secret.js`, re-exported by
`agent-identity.js`, and `nostr-pod-bridge::role_secret`. dream-engine's `load_signing_key`
keeps the same contract. The precedence is:

1. `<NAME>_FILE`;
2. `$AGENTBOX_SECRETS_DIR/<NAME>` (§2's isolated config);
3. the bare variable, only with the flag off.

Under the flag, a bare ROLE variable that is present at all is logged as `ROLE-ISOLATION-LEAK`
and ignored. Flag off, the environment handed to supervisord is byte-identical (RC-X1-06).
`tailscale-up` now gets `--authkey=file:<path>`, which closes the argv finding below.

## Status: what exists and what is owed

**Built (W0 + W1, staged, unverified in an image).**

- The three bypasses are closed (W0).
- The accounts, the mount, the derived isolated config and plan, the delivery and the flag
  wiring are in place (W1).
- With the flag off the boot is today's. `tests/config/role-isolation-boot.test.sh` executes the
  real entrypoint blocks and shows `exec supervisord -c /etc/supervisord.conf`, no delivery and no
  state write.

**Owed before the flag may be turned on.** Under the flag today, role programs fail closed.

- **W2 custody.** It locks the at-rest volumes (`secrets/` and `identities/` to `root 0700`,
  files to `0400`), with an idempotent migrate/revert. **Until W2, devuser can still read the
  at-rest copies in `/var/lib/agentbox/secrets` and the workspace treasury keys**, so the flag
  gives no confidentiality on its own.
- **W2 other items.**
  - ~~A public-only `identity.env`.~~ Done (§3a, `custody/w2-env-scrub`).
  - The aoe-share copy for `ab-gateway` and `ab-ingress`. Both still point at devuser's
    `serve.url`.
  - Ownership of the relay data dir `/var/lib/nostr-relay` for `ab-identity`.
  - The `role-exec` launcher: environment clear, store-only `PATH`, umask 077. It will change
    role programs' `command=` lines, and the drift test's allowed set must widen to `command=`
    explicitly when it lands.
- **W3a/W3b.** The identity port, and the consumer cutover: the pods signer, JunkieJarvis, the
  mirror hook, the gateway and dream-engine.
- **Readers of the delivered files.**
  - ~~`nip98-proxy` reads `NIP98_PROXY_ALLOW_BEARER` and `NIP98_PROXY_SESSION_SECRET` from its
    environment only.~~ Done (§3a): it reads `$AGENTBOX_SECRETS_DIR/<NAME>` as `ab-ingress`.
    Recorded fact: the bearer is still the same value as `BRIDGE_TOKEN`, which stays
    devuser-class until the Q4 split (ADR-2027).
  - The gateway now reads the operator key file-only under the flag (§3a). As `ab-gateway`
    it holds no key by design, so it signs nothing until the identity port (W3a/W3b).
- **W4.** The sidestr upstream baked from Nix. As `ab-sidestr-*`, git refuses the devuser-owned
  workspace checkouts. W4 also moves the state off the workspace and creates the
  `ab-sidestr-read` group.

### Deviations from the design, with reasons

- **The isolated config is named `supervisord.isolated.conf`**, not `supervisord.roles.conf`,
  per the lead's brief. W6a's rehearsal currently probes `supervisord.roles.conf`. One of the two
  must be renamed before the rehearsal runs.
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
- `[program:tailscale-up]` passed `TAILSCALE_AUTHKEY` on argv (pre-existing, root program).
  Resolved by W2 (§3a). Under the flag the key is delivered root-only to
  `/run/secrets/root/TAILSCALE_AUTHKEY` and passed as `--authkey=file:<path>`, a form
  tailscale 1.102 documents. With the flag off the original branch runs unchanged.
- `[program:docker-read-proxy]` (W0) carries a TODO to move into this registry. It needs no
  account: it holds no secret and must start as root to join the socket's group before dropping to
  65534. The comment is left in the supervisor text so that today's config stays byte-identical,
  and it goes at the next edit of that block.

## Consequences

- The image gains 8 passwd and 8 group lines, `/etc/supervisord.isolated.conf`,
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
- `/etc/supervisord.isolated.conf` and `/etc/agentbox/role-secrets.tsv` exist.
- `supervisorctl status` matches the pre-rebuild set.
- `/run/secrets` is `devuser 0700`, and `nostr.key` is present as before.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody W2 (`custody/w2-env-scrub`, rebased onto this record's branch). §3a above
records what it adds. The entrypoint's exec block now runs `_ab_role_env_scrub` between the
config pick and `exec`. `tests/config/role-isolation-boot.test.sh` stubs the scrub and
asserts deliver → pick → scrub → exec (22/22). `flake.nix` changes only `[program:tailscale-up]`
and a comment. The §3 plan, the accounts and the isolated config are untouched, and their suites
pass: `role-secrets-delivery` 26/26 and `role-isolation-supervisor` 20/20. The image is
unverified until the owner's rebuild.
