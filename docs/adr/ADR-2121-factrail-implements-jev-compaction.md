---
id: ADR-2121
title: Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit
date: 2026-10-02
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: d39db513159bf386a97f5aedc2c86ea49d0e168f
verified_paths: [lib/factrail.nix, lib/lockfiles/factrail-57ac25b5.Cargo.lock, lib/claude-code-binary.nix, config/entrypoint-unified.sh, config/claude-plugins/.claude-plugin/marketplace.json, scripts/factrail-store-migrate.mjs, tests/config/factrail-store-migrate.test.mjs, tests/config/factrail-projection.test.sh, schema/agentbox.toml.schema.json, scripts/bake-ruflo-console.sh, scripts/ruflo-console-project.mjs, tests/config/ruflo-console.test.mjs]
owner: jjohare
review_trigger: a factrail rev bump in lib/factrail.nix, the end of the post-rebuild residency soak, a Claude Code function-hook API change, or a decision to train a local judge on recorded Jev decisions
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2093 (the decision this implements; amends its implementation, not its policy), ADR-2094 (local-backend fence relaxation, unchanged)
---

# ADR-2121 — Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit

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
