---
id: ADR-2121
title: Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit
date: 2026-10-02
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: b65c3d4eda3c2449d7ea8512ae1bda33a24c2312
verified_paths: [lib/factrail.nix, lib/lockfiles/factrail-57ac25b5.Cargo.lock, lib/claude-code-binary.nix, config/entrypoint-unified.sh, config/claude-plugins/.claude-plugin/marketplace.json, scripts/factrail-store-migrate.mjs, tests/config/factrail-store-migrate.test.mjs, tests/config/factrail-projection.test.sh, schema/agentbox.toml.schema.json, scripts/bake-ruflo-console.sh, scripts/ruflo-console-project.mjs, tests/config/ruflo-console.test.mjs]
owner: jjohare
review_trigger: a factrail rev bump in lib/factrail.nix, the end of the post-rebuild residency soak, a Claude Code function-hook API change, or a decision to train a local judge on recorded Jev decisions
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2093 (the decision this implements; amends its implementation, not its policy), ADR-2094 (local-backend fence relaxation, unchanged)
---

# ADR-2121 — Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

## Re-verification — 2026-10-02 at caab741c6 (factrail landing anchor)

Anchored to the landing of ADR-2121 (`b7fc2b0e5`, wording follow-up `caab741c6`). Every governed path above is as verified in ADR-2121's Verification section; nothing else changed. Image build, boot and the residency soak remain unverified (`activation_status: staged`).

## Context

ADR-2093 replaced the compaction summary with Jev decisions through a vendored copy of
`tamaratran/fast-jev-compaction`, which *deletes* every call Jev lets go. Since then
`deadczarvc-labs/jev-factkeep-compaction` and `deadczarvc/hermes-jev-compaction` (both MIT)
published fact rails: reduce instead of delete, keep each result's fact lines, save the full
output. On their blind held-out test the rails kept 50 of 50 pre-registered facts against 4 of
50 for upstream, at the cost of keeping ≈45–50% of tokens instead of 7–10%. Locally,
`min_reduction_ratio = 0.55` papered over the re-arm problem with an estimate that ignored the
fixed system/tool prefix. The estate's rule is Rust for glue and evaluators, and a reusable
port becomes a published crate.

## Decision

ADR-2093's policy (Jev judgement, verbatim, email fenced out, a switch) stands. This record
replaces how it is implemented and the parts of it listed here.

1. **factrail is the implementation.** `DreamLab-AI/factrail` (public, MIT OR Apache-2.0,
   NOTICE credits the three MIT sources) re-implements the judge flow, the fact rails and
   Hermes's pooled fact budget, metadata egress and windowed state in Rust, with a thin
   TypeScript function-hook shim that delegates every decision to the binary over a
   versioned stdin/stdout protocol (factrail `docs/protocol.md`). The vendored
   `config/claude-plugins/jev-compaction` and its two test files are deleted.
2. **One pinned commit, baked.** `lib/factrail.nix` builds the factrail workspace at a full
   40-character `rev` (fetch `hash` pinned, lockfile vendored as
   `lib/lockfiles/factrail-<rev8>.Cargo.lock`, the whole workspace's tests run in the
   build). `flake.nix`, gated on `[features.jev_compaction].enabled`, links the binary at
   `/opt/agentbox/bin/factrail` and bakes the shim into the `agentbox` directory marketplace
   as `config/claude-plugins/factrail`, so shim and binary never disagree on the protocol.
   The plugin's `binary` option is the stable `/opt` path, never a store path.
3. **The gate keeps its name and its fence.** `[features.jev_compaction]` stays the gate
   (E074, W072, the catalogue id unchanged). Its `apply_class` becomes `rebuild`: the binary
   is part of the image. The email taint fence fences the same class and stays sticky per
   session. What a fenced session *gets* changes: on a cloud judge it is compacted by local
   fact rails (`fallback = "rules"`: no model, no network) instead of the built-in summary;
   on a declared-local judge it is judged and reported `ok-local`, as ADR-2094 specifies.
4. **The sticky taint survives the change of plugin.** Claude Code keys a plugin's store by
   `sha256("<name>@<marketplace>")`, so factrail starts with an empty one. At boot, before
   install, `scripts/factrail-store-migrate.mjs` merges every tainted `taint:<session>`
   record and the switch position from jev-compaction's store into factrail's (taint only
   widens; factrail's own switch is never overwritten), then renames the old file
   `.migrated`. It refuses, leaving both files untouched, when either store is unreadable,
   and says so in the boot log.
5. **`min_reduction_ratio` is retired.** factrail sizes the cut from the real context: it
   aims at 5/6 of the trigger with the fixed prefix counted, reduces result by result
   cheapest facts first, and evicts the oldest outputs (saved first) to get under the
   trigger. Only when even eviction cannot reach the trigger does `fallback` apply. The
   schema rejects the key.
6. **New manifest keys**, projected as userConfig: `egress` (`full` | `metadata`),
   `fallback` (`rules` | `summary`), `compaction_timeout_ms`, `save_full_outputs`,
   `record_decisions`. Every projected pair is checked against the userConfig the baked
   plugin declares; an undeclared key is skipped with a log line instead of failing the
   install. An empty manifest value is not projected, so the plugin's default holds.
7. **Egress does not widen.** The judge sees text, tool inputs (capped, or only their shape
   under `egress = "metadata"`) and `ok|error, N chars` for each result, never result
   contents, as ADR-2093 states. Saved outputs and the decision log stay on the machine
   (`~/.cache/factrail/outputs`, `~/.local/share/factrail/decisions`, mode 0600), and the
   decision log is never written for a tainted session.
8. **The retired plugin is removed wherever it is found**, whatever the gate, because two
   compaction plugins on one `session.compact` chain would both act.

## Consequences

- Compaction keeps facts it used to delete, and anything reduced is one `Read` away in a
  saved file. The cost is residency: more context survives each compaction. ADR-2093's
  $14–18 per busy agent-hour was measured for the deleting plugin and does not describe
  this one. **Activation condition:** `activation_status` moves to `live` only after a soak
  that records compactions per hour, post-compaction context size and cache-read spend
  against the 2026-10-01 baseline (42 compactions, median 84k after), plus the binary's
  per-call latency (the shim starts it on every tool call for the taint check, capped at
  5 s).
- Email-tainted sessions stop losing compaction quality: they get local fact rails instead
  of the summary, with nothing sent.
- The switch is `/factrail on|off|status`; `/jev-compact` is gone. Its stored position is
  carried over.
- A factrail change reaches the image only through a `rev` bump in `lib/factrail.nix`
  (hash and lockfile with it). That is the review point for every change to compaction.
- Recorded decisions are the training and evaluation data for a local judge
  (factrail `dataset`, `eval --gate`). Training on Jev's outputs waits on TypeSafe's terms
  and is not part of this decision.
- Publishing factrail's reusable crates to crates.io follows the soak, so the published API
  is one that has run live.

## Verification

At the working tree staged on `68270e953` (before the landing commit and before any rebuild):

- **Pin:** the fetch `hash` was computed as the NAR sha256 of the GitHub tarball for `rev`
  by a serialiser that first reproduced `lib/sidestr-agent.nix`'s pinned hash exactly; the
  vendored lockfile is `git show <rev>:Cargo.lock`. The baked paths (`plugin/.claude-plugin`,
  `plugin/hooks/{hooks.json,factrail.ts,protocol.ts}`, `plugin/README.md`, the licence files
  and NOTICE) exist at `rev`. The dependency graph has no git sources and no OpenSSL (rustls
  on ring). factrail CI at `rev` is green, including a Rust 1.85 job.
- **factrail itself at `rev`:** 191 Rust tests (unit, integration, doc, and end-to-end hook
  protocol tests against the built binary), clippy and rustdoc with warnings as errors, fmt;
  the shim's 50 engine tests, `tsc`, and `claude plugin validate --strict`.
- **Wire compatibility with the façade (ADR-2094):** a request captured from
  `factrail compact --judge systemone` parses and validates with
  `system_one_core::wire::Request::parse` (8 Noul questions), and factrail reads answers as
  `answers[name].noul`, the façade's serialisation of `Answer::Noul`.
- **Store migration:** `node --test tests/config/factrail-store-migrate.test.mjs` → 9
  passed, including that the store name scheme reproduces the two store files on disk. A
  dry run on a copy of the live store carried all 16 tainted sessions.
- **Projection:** `bash tests/config/factrail-projection.test.sh` → 8 passed, including
  that every key the entrypoint projects is declared by the plugin at `rev`.
  `tests/config/jev-config-stamp.test.sh` and `tests/config/boot-projection-contract.test.sh`
  → pass; `bash -n config/entrypoint-unified.sh` → clean.
- **Manifest:** `node scripts/agentbox-config-validate.js agentbox.toml` → valid, the same
  five advisory warnings as before; copies with `min_reduction_ratio`, `egress = "loud"`, or
  `taint_tools` without the email prefix → E016, E016, E074.
  `node scripts/ci/check-manifest-catalogue.js` → pass.
- **Ledger rule:** this record lands `accepted` with its implementation, so it adds nothing
  to the `proposed` backlog; `scripts/adr-ratchet.sh` counts only records added undecided
  (`tests/config/adr-ratchet.test.sh` → 6 passed).
- **Not yet verified:** the image built and booted with the plugin installed, and a live
  `/factrail status` in a fresh session. `activation_status: staged` until then, and `live`
  only after the soak above. `verified_commit` is re-anchored to the landing commit in the
  commit that follows it.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff f63760e19..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `schema/agentbox.toml.schema.json` adds the `dreamlab-txbt4` object under `sidechain`. No other property changed. No `[features.jev_compaction]` or factrail schema property changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-02 (`6db0ffc8df1e708047c210353f730d1f0427553d`)

Tripped by ADR-2097 (the sidestr payment rail). `schema/agentbox.toml.schema.json` gains `payments.properties.sidestr` only. Nothing this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff f7465412d..6db0ffc8d -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`e020264b54c6872ca98995c1adda18b8451a39af`)

Tripped by ADR-2097 (the rail keyed by chain). `schema/agentbox.toml.schema.json` changes only `payments.properties.sidestr` (`producer_url` optional, `mirror_url` added). Nothing else this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff 6db0ffc8d..e020264b54c6872ca98995c1adda18b8451a39af -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). The schema gains only `security.role_isolation`. The factrail projection and `[features.jev_compaction]` are untouched. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on.
factrail's pin and Jev compaction's wiring are untouched. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `config/entrypoint-unified.sh` (`dc91e092a`) gains `_ab_devuser_privilege_check` and its call after the docker-socket check; it reads files only and is a no-op with `[security].role_isolation` off. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `config/entrypoint-unified.sh` changes only in three custody blocks (ADR-2122, design 3.2). (1) A new at-rest step before Phase 3: `ab_custody_migrate` when `[security].role_isolation` is on, otherwise `ab_custody_revert`, which changes nothing on a volume that was never migrated (`tests/config/role-custody-migrate.test.sh` shows the stat set, ctime included, byte-identical). (2) Under the flag only, the volume-root chown loop skips `/var/lib/agentbox/secrets`. (3) After the identity bootstrap, the identity file goes to ab-identity 0400 under the flag; with the flag off, the devuser 0600 statements are unchanged. The factrail projection and `[features.jev_compaction]` are untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (poker house seat, PR #14)

`f93586b9e..b41d9486c`: the schema declares the closed `[poker_citizen]` object (`b41d9486c`). Nothing this record governs (ADR-2121 — Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit) reads the new table or program. The decision holds. Re-verified by `git log f93586b9e..b41d9486c -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo 3.51.1, Claude Code 2.1.288)

`b41d9486c..daba195e5`: `lib/claude-code-binary.nix` moves Claude Code 2.1.285 → 2.1.288 (`c23592687`); both per-arch hashes equal Anthropic's 2.1.288 manifest checksums. The factrail plugin baked at the pinned rev (`share/factrail/plugin`) passes `claude plugin validate --strict` under the 2.1.288 binary with the hook surface it reports under 2.1.285, unchanged: session.start, tool.call, skill.prompt, command.run, session.compact, turn.start, turn.complete; calls include `$.session.compact` and `$.command.register`. Nothing this record governs (ADR-2121 — Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit) changes meaning. The decision holds. Re-verified by `git log b41d9486c..daba195e5 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification and note — 2026-10-03 (ruflo mods join the `agentbox` marketplace, `451823ca8`)

`daba195e5..451823ca8`: the `agentbox` directory marketplace this record introduced for factrail now also carries ruflo-console, ruflo-mods and ruflo-swarm. These are ruflo's function-hook mods, baked from the ruflo v3.51.1 tag (flake input `rufloConsole`, `09a1cb0`) behind `[toolchains].ruflo_console`, default off, rebuild-class. Three consequences for this record:

1. **Shared marketplace.** Factrail's gate-off branch removed the whole `agentbox` marketplace. It now does so only when `[toolchains].ruflo_console` is also off, and the ruflo block registers the marketplace itself when on. `marketplace.json` lists the three mods beside factrail. `scripts/bake-ruflo-console.sh` fails the build if a baked `plugin.json` version differs from the catalogue.
2. **Shared function-hook switch.** `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is set when either gate is on and cleared only when both are off.
3. **A second registration pattern in one marketplace.** Factrail is still installed with `claude plugin install` into the persistent cache, with the content-digest and config-stamp reinstall. The ruflo mods follow the codex-plugin-cc pattern instead: `scripts/ruflo-console-project.mjs` registers them in `installed_plugins.json` at their stable `/opt/agentbox/config/claude-plugins/<name>` paths, so no cache copy can go stale. It rewrites a wrong path or version every boot, writes `pluginConfigs` cli=`ruflo` (the baked bin; upstream's npx-offline default fails ENOTCACHED on a fresh npm cache), and removes the three ids when the gate is off.

The schema and entrypoint diffs are otherwise limited to the new gate. Factrail's pin, projection and userConfig keys are unchanged (`tests/config/factrail-projection.test.sh` passes). The three new files join `verified_paths`. The decision holds. Re-verified by `git log daba195e5..451823ca8 -- <verified_paths>`. Nix was not evaluated in this container (no `nix` binary); the image is unverified until the owner's rebuild.

### Re-verification — 2026-10-03 (ruflo memory governed, 1fc26c786)

`451823ca8..1fc26c786` (nothing in the governed paths moved before `09e6271e9`): `scripts/ruflo-console-project.mjs` (`2df10dc94`) replaces the `import.meta.url === file://argv[1]` main guard with a realpath comparison, so the projector runs when invoked through the image's symlinked path (before, the comparison failed through the symlink and the boot projection did nothing); `tests/config/ruflo-console.test.mjs` adds that symlink case and now asserts `[toolchains].ruflo_console = true` because `a2ffa05eb` set it on in the shipped manifest; `schema/agentbox.toml.schema.json` declares `faucet_units`/`faucet_sats`, `peg_script`, the `[poker_citizen.<name>]` sub-objects and `[poker_coach]` (`bde96a334`, `a2ffa05eb`, `18a85577c`). `config/entrypoint-unified.sh` changes in one place (`012bf98f5`): three exports in the runtime-env block after `RUFLO_DAEMON_AI_WORKERS` — `RUFLO_DAEMON_AUTOSTART` (default `0`), `CLAUDE_FLOW_DISABLE_BRIDGE` (default `1`) and `CLAUDE_FLOW_MEMORY_PATH` (default `/home/devuser/.cache/ruflo/memory`), each `${X:-default}` so an operator export wins (ADR-2123). `lib/factrail.nix`, the lockfile, `lib/claude-code-binary.nix`, `marketplace.json`, the store-migrate script and both factrail tests did not move. The decision — factrail implements Jev compaction, in Rust, at a pinned commit — is not affected: the pin, the shim and the projection are unchanged. One dated statement in the `451823ca8` note moves: `ruflo_console` is no longer "default off" in the shipped manifest, so in the running configuration factrail's gate-off branch does not remove the `agentbox` marketplace (consequence 1 of that note) because the console gate holds it. `tests/config/ruflo-console.test.mjs` passes 15/15 at HEAD. Re-verified by `git diff 451823ca8..1fc26c786 -- <verified_paths>`.

### Re-verification — 2026-10-03 (runtime-env path escape, 34f5e4254)

`1fc26c786..34f5e4254`: `config/entrypoint-unified.sh` changes one line in the runtime-env heredoc — `CLAUDE_FLOW_MEMORY_PATH` is escaped so it resolves in the sourcing shell (`$HOME/.cache/ruflo/memory`) instead of as a root-side `/home/devuser` literal (RC-X1-01, `34f5e4254`). No path, gate, projection or program this record governs changed. Nothing this record decides changed.

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

Since `34f5e4254`, `lib/claude-code-binary.nix` and `schema/agentbox.toml.schema.json` changed among the governed paths. Every other governed path has no diff:
- `lib/factrail.nix` is still at rev `57ac25b59d4b5975bbed1f066eb6ec294b38116a`, and its lockfile is unchanged.
- `config/entrypoint-unified.sh`, `marketplace.json` and the store-migrate script are unchanged.
- The ruflo-console files and the three factrail and ruflo tests are unchanged.

`9415186f3` moves Claude Code from 2.1.288 to 2.1.291 with new per-arch hashes. That falls under this record's review trigger (a Claude Code function-hook API change), so it was checked. `claude plugin validate --strict` on the baked factrail plugin under the 2.1.291 binary passes. It reports the same hook surface recorded at 2.1.288: session.start, tool.call, skill.prompt, command.run, session.compact, turn.start and turn.complete, with calls including `$.session.compact` and `$.command.register`. One stale code comment came with the bump: the header in `lib/claude-code-binary.nix` still read "2.1.289" above `claudeCodeVersion = "2.1.291"`. `d39db5131` corrects it to 2.1.291, built 2026-10-06T02:41:25Z per the release manifest, and changes nothing else; the stamp moves to that commit. The schema gains only `sovereign_mesh.forum_governance` (`afc8a0ed6`, ADR-2109) and the top-level `diagram_review` object (`cc5f5dcc0`, `2bc789d33`, `09a024b12`, ADR-2131). No `[features.jev_compaction]` property changed. The decision holds.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- factrail pinned at one 40-char rev in lib/factrail.nix with vendored lockfile lib/lockfiles/factrail-<rev8>.Cargo.lock
- flake.nix gates factrail binary at /opt/agentbox/bin/factrail and shim in config/claude-plugins/factrail on [features.jev_compaction].enabled
- schema is closed and rejects min_reduction_ratio; new keys egress/fallback/compaction_timeout_ms/save_full_outputs/record_decisions exist
- entrypoint projects those userConfig keys, filtered against plugin-declared keys; empty value not projected
- retired jev-compaction plugin removed whatever the gate
- plugin 'binary' option is the stable /opt path
- marketplace shared with ruflo mods; bake-ruflo-console checks versions against marketplace.json
- named tests pass

Evidence:

- lib/factrail.nix:36 rev = 57ac25b59d4b…; hash line 42; lockfile lib/lockfiles/factrail-57ac25b5.Cargo.lock exists; lib/factrail.nix not in the diff
- flake.nix:1819-1820,2049-2051,2115-2119 → factrailPkg gated by jevCompactionOn, /opt/agentbox/bin/factrail link, plugin copy
- schema at 218dc12c3: features.jev_compaction additionalProperties=false, properties include egress, fallback, compaction_timeout_ms, save_full_outputs, record_decisions and NO min_reduction_ratio
- entrypoint:2833 _jc_project "binary=$_JC_BIN" (/opt/agentbox/bin/factrail); 2846-2850 projection of the five new keys; 2790-2797 retired-plugin uninstall unconditional on gate
- hunks: marketplace.json adds a jev-checkpoints entry only; schema adds vault.loom_sync/loom_url/loom_host, ruvector_external flags, system_one, features.jev_checkpoints; entrypoint adds ADR-2140/2139/2135 blocks; claude-code-binary.nix bump; bake-ruflo-console.sh adds routeTasks patch (ADR-2134) on ruflo-mods only; tests adjust boundary regexes for jev-checkpoints → none touches a claim
- bash tests/config/factrail-projection.test.sh → 8 passed, 0 failed (awk boundary now ends at '# ── ADR-2135: Jev checkpoints', which exists)
- node --test tests/config/factrail-store-migrate.test.mjs → 9/9; ruflo-console.test.mjs → 17 pass, 0 fail, 1 skipped; jev-config-stamp.test.sh PASS; boot-projection-contract.test.sh 13/13
- node scripts/agentbox-config-validate.js agentbox.toml → valid, 6 advisory warnings (record said five; W076 added by ADR-2139)

Commands run: `bash tests/config/factrail-projection.test.sh; bash tests/config/jev-config-stamp.test.sh; bash tests/config/boot-projection-contract.test.sh; node --test tests/config/factrail-store-migrate.test.mjs tests/config/ruflo-console.test.mjs; node scripts/agentbox-config-validate.js agentbox.toml; node scripts/ci/check-manifest-catalogue.js`

Not checked, and notes: Two point-in-time statements in the Verification section have drifted but are not decision claims: (1) 'check-manifest-catalogue → pass' now FAILS (rc=1) on 7 uncatalogued booleans belonging to other ADRs (integrations.ruvector_external.reader_role/hba_scram [ADR-2133], system_one.backends.*.local [ADR-2139], diagram_review.weekly_window); jev_compaction/jev_checkpoints keys are not among them. (2) validator now reports six advisory warnings, not five. Worth flagging to the owners of 2133/2139 rather than amending this ADR. Image build/boot unverified (staged).

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. Only the unrelated spatial schema property is added; factrail and the Jev compaction wiring are untouched. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff efa293b87..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.


## Re-verification — 2026-10-21

Ruflo console/mods/swarm versions match the v3.57.0 source; the routeTasks-off patch retains the upstream advisory continuation. All 18 plugin bake/registration tests pass against the real pinned tree. Factrail and Jev entries are unchanged. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: `git diff --stat 16139219..HEAD` over the governed paths shows changes only in `marketplace.json`, `lib/claude-code-binary.nix` (2.1.306 to 2.1.309), `scripts/bake-ruflo-console.sh` (a comment) and `tests/config/ruflo-console.test.mjs`; the factrail, entrypoint, schema, lockfile and store-migrate paths have no diff. In a detached worktree at HEAD, `node --test tests/config/ruflo-console.test.mjs` gives 17 pass, 0 fail, 1 skipped, and `HEAD:marketplace.json` still lists factrail 0.1.0 beside ruflo-console 0.45.0, ruflo-mods 0.6.2 and ruflo-swarm 0.3.7. **Correction to the 2026-10-21 note above:** its sentence "versions match the v3.57.0 source" is no longer true. The `rufloConsole` input is now pinned to the 3.60.0 release-branch commit `856de8f3` (`flake.nix:68`, `flake.lock`) while `rufloPkg` stays at 3.57.0 (`flake.nix:519`), a deliberate and documented split until 3.60 npm artefacts publish. This record never claims plugin and runtime share a version; the local immutable `ruflo` bin remains mandatory and npx forbidden. Revisit when both pins are aligned.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.


Security follow-up re-verified 2026-10-29 at `7d8c3b2dfe165f4ab3f8a5e4f62b8294ea7b155d`: the changed hunks drop privilege before workspace credential writes, replace credentials atomically, reject typed-decision redirects and retain the timeout through response parsing. The stalled-body, planted-symlink and HTTP307 regressions pass. These strengthen the existing boundaries; status axes and activation limits are unchanged. The original Deepsec report remains BLOCK with a separate remediation receipt, not a claimed clean rescan.

Re-verified 2026-10-29 at `6ceb22489`: factrail `d270a0a1` keeps the implementation this record
describes and adds judge provenance: `JudgeInfo` gains an optional `backend` (serde default, so
older decision logs still read) and records the model the response reports rather than the
configured one; `/factrail status` reads the proxy's `/health` with a 2 s fail-open timeout and
never probes the vendor cloud. `Answered` and `JudgeInfo` gain public fields, a semver-minor
break for any external struct-literal user. 209 tests and clippy -D warnings pass on the merged
tree. Not checked: an image build of the new pin.

Re-verified 2026-10-30 at `cd3a29899`: the delta in schema/agentbox.toml.schema.json is [system_one] only (new `network` and `local_only` properties; `bind` admits 0.0.0.0/RFC 1918); management-api/lib/system-manifest.js gains one entry, `system-one-network`; scripts/agentbox-config-validate.js changes only the [system_one] E080 bind rule. This record's sections are untouched.

Re-verified 2026-10-30 at d0e9ca786: the only change to the governed paths is the new `[system_one].skill_list_at_least` key and its schema property (router runner-up listing, ADR-2091); no section this record governs changed.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `config/entrypoint-unified.sh`: the `ONTOLOGY_PAGES_DIR` / `AGENTBOX_VAULT_LEGACY_PATHS` override tier is removed (ADR-2028 re-verification), `ONTO_PAGES` reads `VAULT_PAGES`, and the Phase 5d skip line says "[vault] liveness gate" (`7aa9365d4`); `schema/agentbox.toml.schema.json`: the `[vault].working` description says pages sit at the working root (`f4beec643`). No section this record governs changed; the decision holds. Re-verified by `git diff d0e9ca786..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.
