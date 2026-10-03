---
id: ADR-2028
title: "`[vault]` in agentbox.toml is the single path authority for the authored corpus; no consumer hard-codes a Logseq path"
date: 2026-09-02
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: dc91e092ab646b4a825805b8229602ac8b15bad3
verified_paths: [agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json, config/entrypoint-unified.sh, mcp/servers/lib/ontology-local.js, mcp/servers/lib/ontology-index-build.js, scripts/ontology-condense-scheduler.mjs, scripts/ontology-condense-refresh.sh, skills/podcast-knowledge-ingest/SKILL.md, skills/ontology-core/SKILL.md, skills/ontology-enrich/SKILL.md, skills/ontology-augment/SKILL.md, skills/web-summary/SKILL.md]
owner: jjohare
review_trigger: any new skill, MCP server, or supervised program that reads or writes authored markdown
repo: agentbox
domain: BASELINE-container
lineage: ADR-2003 (manifest-driven composition), ADR-2008 (single source of truth + reconciling projector), legacy ADR-113 (condensation trigger on the corpus)
---

# ADR-2028 — `[vault]` is the single path authority for the authored corpus

## Context

Four agentbox surfaces hard-code `/home/devuser/workspace/logseq/...`:
the entrypoint (`config/entrypoint-unified.sh:504`), two MCP server libraries
(`mcp/servers/lib/ontology-local.js:22`, `ontology-index-build.js:15`), the
condensation scheduler, and the `podcast-knowledge-ingest` skill
(`SKILL.md:62-63`). The host project is moving the corpus to an Obsidian vault
(VisionClaw ADR-2040) whose root will be a different directory. Every
hard-coded path is a silent-degradation point: the consumer keeps "working"
against a stale tree.

## Decision

1. `agentbox.toml` gains a top-level `[vault]` section, schema-validated:

   ```toml
   [vault]
   root   = "/home/devuser/workspace/visionGraph/knowledge"   # vault root = the visionGraph corpus checkout, knowledge/ vault (bind-mounted)
   pages  = "pages"                            # authored pages, relative to root
   format = "obsidian"                         # obsidian only (logseq-legacy withdrawn 2026-09-22)
   tui    = "rune"                             # rune | none — see ADR-2029
   working     = "/home/devuser/workspace/visionGraph/working"      # second vault root (pages at <working>/pages)
   transcripts = "/home/devuser/workspace/visionGraph/transcripts"  # podcast transcript store, outside both vaults
   ```

   The corpus repo is `jjohare/visionGraph` (owner decision 2026-09-02, a
   history-preserving split of the archived `jjohare/logseq`): two sibling
   Obsidian vaults, `knowledge/` and `working/`, plus `transcripts/`. A
   layout with more than one vault root cannot be expressed by `root`
   alone, hence the two extra keys.

2. The entrypoint exports `VAULT_ROOT`, `VAULT_PAGES` (= `root/pages`),
   `VAULT_WORKING_ROOT`, `VAULT_WORKING_PAGES`, `VAULT_TRANSCRIPTS` and
   `VAULT_FORMAT` from the manifest for every supervised program and every
   tmux window, and derives `ONTOLOGY_PAGES_DIR` from `VAULT_PAGES` (the old
   variable stays as an override for one release).
3. Every consumer listed in `verified_paths` reads `VAULT_PAGES` /
   `VAULT_ROOT`; the former Logseq literals are deleted, not left as fallbacks.
   If `VAULT_ROOT` is unset **and** the manifest lacks `[vault]`, consumers
   log one clear line and disable themselves (fail-loud), mirroring the
   ADR-2004 adapter posture.
4. Skills that write pages (`podcast-knowledge-ingest`, `web-summary`'s
   note-link mode) emit the frontmatter format of the governing doc
   `project/docs/VAULT-corpus-format.md` §V2; `web-summary`'s default
   `format` becomes `obsidian`. The Logseq option was withdrawn on 2026-09-22;
   `obsidian` is the only format (see the Disposition, 2026-10-02).
5. `system-manifest` reports the resolved vault root and format so the
   management API and the doctor can show drift.

## Consequences

- One edit in the manifest relocates the corpus for every agent surface.
- Containers without a manifest vault report disabled, but the retained legacy override can still direct consumers to a corpus. That compatibility path must be shown separately.
- The skills directory prose (`SKILL-DIRECTORY.md`, the ontology-* skills)
  changes from "Logseq" to "vault" wording; historical archive docs are left
  untouched.

## Verification

2026-09-02 on the `obsidian` branch: `bash -n config/entrypoint-unified.sh`
clean; the `_ab_toml_*` manifest readers were hoisted above the Stage A/B
dispatch and `_ab_vault_resolve` exports `VAULT_ROOT`/`VAULT_PAGES`/
`VAULT_FORMAT`/`VAULT_TUI` before `exec supervisord` and appends them to
`/run/agentbox/runtime-env.sh` (the channel bash/fish shells and tmux windows
already source); verified against the live manifest (`tui=rune`), the
vanilla default (`tui=none`), a manifest without `[vault]` (one
`[vault] disabled` line, `VAULT_ROOT` unset) and an unreadable manifest
(same, fail-open). `npm run test:vault` — 20/20 for
`mcp/servers/lib/vault-frontmatter.js`. Schema validator: both manifests
valid. `scripts/ci/check-no-logseq-paths.sh` (wired into
`.github/workflows/invariants.yml`) passes and was shown to fail on a
planted literal. `management-api/lib/system-manifest.js` carries the
`vault` catalogue entry (`apply_class: boot`; the Rune package is
`rebuild`-class under ADR-2029) and reports the resolved root/pages/format.
`implementation_status: partial`; `activation_status: staged` until the
next container boot runs the new entrypoint.

## Closeout extension — 2026-09-04

CP-01/02/06/08. Owner remains jjohare with vault/runtime maintainers. An isolated call to the actual resolver with no manifest vault retains ONTOLOGY_PAGES_DIR while setting AGENTBOX_VAULT_ENABLED=0. Consumers prefer that override. Implementation changes to partial for the broad all-consumers-disabled claim; the manifest projection itself remains implemented.

**Acceptance condition:** Define and test manifest/environment/legacy precedence, disabled-with-override behaviour, path relocation and consumer read identity. Include namespaces, private pages and absent roots; removing old path literals is not proof of equivalent inclusion. Reopen on resolver, consumer, launcher, storage or TUI changes. Both shell files pass syntax checking; no live terminal/editor or image activation test ran. See the [vault review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/authored-vault-transition.md#runtime-path-overrides-and-notes-launch) and [source/probe receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/vault-path-probe.json).

## Acceptance progress — 2026-09-05

- **Implemented** — `_ab_vault_resolve()` in `config/entrypoint-unified.sh` now
  documents and enforces an explicit three-tier precedence in its comment block:
  (1) the manifest `[vault]` projection is the highest authority — `VAULT_PAGES`
  is always the manifest's, whatever the inherited environment said; (2) an
  explicit environment override is honoured ONLY while the vault is enabled, or
  under the new opt-in `AGENTBOX_VAULT_LEGACY_PATHS=1`; (3) the deprecated
  `ONTOLOGY_PAGES_DIR` is CLEARED (exported empty) with one clear warning naming
  the path and the opt-in when `AGENTBOX_VAULT_ENABLED=0` and no opt-in is set,
  so no consumer can silently fall back while the system reports the vault
  disabled. Behaviour with the vault enabled is unchanged (the override still
  applies, now with a note). All four consumers were given the matching guard and
  fail clearly instead of using a legacy path: `ontology-local.js` refuses the
  override and serves an empty index with a `REFUSING corpus path …` line;
  `ontology-index-build.js` and `scripts/ontology-condense-refresh.sh` exit **2**
  and leave the index and PUSH cache untouched; the scheduler returns
  `error/legacy-path-vault-disabled`, exits 2 for `--once`/`--dry-run` and stops
  the loop (a refused path is a configuration error, not a transient fault, so
  the house fail-open rule does not apply). An explicitly typed `argv` pages dir
  is still honoured — with a warning — because it is not a silent fallback.
  Incidental fix in `ontology-condense-refresh.sh`: `exec 9>"$LOCK" 2>/dev/null`
  had permanently re-pointed the whole script's stderr at `/dev/null`, swallowing
  every diagnostic it printed; stderr is now saved on fd 8 and restored after the
  lock attempt.
- **Tests and results** — new `tests/config/vault-path-precedence.test.sh`
  extracts the ACTUAL `_ab_vault_resolve` from `config/entrypoint-unified.sh`
  (same anchored `^_ab_vault_resolve\(\) \{ … ^\}` extraction as
  `vault-path-probe.py`) with a stub `_ab_toml_val`, and also drives the shell
  consumer: **13 passed, 0 failed, exit 0** — no-vault+no-override;
  no-vault+legacy-override (cleared, warning naming the path AND the opt-in);
  no-vault+legacy-override+`AGENTBOX_VAULT_LEGACY_PATHS=1` (retained, says so);
  vault-present with a competing env override (manifest wins for `VAULT_PAGES`,
  tier-2 override still honoured and noted); vault-present with no override
  (derived); relocation; relocation with a stale Logseq-era override still set.
  New `tests/config/vault-consumer-fallback.test.mjs` runs each JS consumer as a
  child process against throwaway fixture corpora: **13 passed, 0 failed, exit
  0** — refusal, opt-in honouring, vault-enabled behaviour unchanged, typed-argv
  warning, and the scheduler's exit codes. `bash -n` and `node --check` clean on
  every file touched.
- **Receipts** —
  `docs/estate-closeout/2026-09-05/adr-2028-vault-path-precedence.json`
  (both suites' full stdout, exit codes, syntax/`--check` results, source
  SHA-256s). No real manifest, vault or corpus was read or written.
- **Remaining** — not exercised here: namespace/private-page inclusion identity
  between a Logseq-era tree and the Obsidian vault (path precedence is not proof
  of equivalent inclusion), the podcast/transcript sibling roots, and activation
  on a booted image running the new entrypoint. `activation_status` therefore
  stays `staged` and `implementation_status` stays `partial`.
- **Governed paths changed** — `config/entrypoint-unified.sh` (the
  `_ab_vault_resolve` function and its comment block only),
  `mcp/servers/lib/ontology-local.js`, `mcp/servers/lib/ontology-index-build.js`,
  `scripts/ontology-condense-scheduler.mjs`,
  `scripts/ontology-condense-refresh.sh`,
  `tests/config/vault-path-precedence.test.sh` (new),
  `tests/config/vault-consumer-fallback.test.mjs` (new).

## Disposition — 2026-10-02

- **Suitability:** fits, needs revision
- **Priority:** P1 — this cycle (settle the proposed-ADR census, TODO "Proposed decision records"; CY-A4 ratchet to 20 Oct)
- **Why:** The image booted on 2026-10-01 projects the manifest: `/run/agentbox/runtime-env.sh` exports `VAULT_ROOT`, `VAULT_PAGES`, `VAULT_WORKING_*`, `VAULT_TRANSCRIPTS`, `VAULT_FORMAT=obsidian`, `VAULT_TUI=rune` and `VAULT_REPO`, all verified in this session. The text has fallen behind in three places. `logseq-legacy` is no longer a `format` value (only `obsidian`, per the ADR-2105 re-verification of `d6b976271`). The `repo` key and `VAULT_REPO` were added. The Logseq-to-Obsidian inclusion-equivalence item in Remaining is moot, because the converter is retired (host ADR-2117, TODO N-1). ADR-2107 now names the vault CLI as the agent door, building on this record.
- **Next:** Note the three revisions in an amendment, then it is ready to accept, with activation `live` on the runtime-env evidence above. **Accepted — owner decision 2026-10-02, Q8** (re-verified at `a238a3764`: `/run/agentbox/runtime-env.sh` exports all eight `VAULT_*` names, `VAULT_FORMAT="obsidian"`, `VAULT_TUI="rune"`). Revisions made in place: Decision 1's `format` comment and Decision 4 now say `obsidian` is the only format; Decision 2's export list is extended by the `repo` key's `VAULT_REPO` (added at `d6b976271`, ADR-2105 re-verification); the inclusion-equivalence item under Remaining (2026-09-05) is moot because the converter is retired (host ADR-2117). `implementation_status: complete`, `activation_status: live`.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `agentbox.toml` changes only in `[integrations.solid_pod_rs]`: `sign_requests` false→true and the comment block above it (ADR-2078); `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078); `setup/agentbox.default.toml` carries the same single `sign_requests` change and comment block. It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff be358df7b..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `agentbox.toml` adds the `[sidechain.dreamlab-txbt4]` table, with `enabled = false`. No other key changed. `schema/agentbox.toml.schema.json` adds the `dreamlab-txbt4` object under `sidechain`. No other property changed. No `[vault]` key or vault schema property changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-02 (`6db0ffc8df1e708047c210353f730d1f0427553d`)

Tripped by ADR-2097 (the sidestr payment rail). `agentbox.toml` gains one new table, `[payments.sidestr]` (ADR-2097), placed after `[skills.payment_router]`; no existing key, value or line above it moves; `schema/agentbox.toml.schema.json` gains `payments.properties.sidestr` only. Nothing this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff f7465412d..6db0ffc8d -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`e434a7a596a3a0518c51b7da107d6e0831891910`)

Tripped by the sidechain health and witness change. `agentbox.toml` changed only in `[voice]`: `enabled` false → true, with a comment, so that the descriptive sidecar state matches the four running agentbox-voice containers (CY-A2, `scripts/ci/check-declared-vs-running.js`). No other key moved. `[vault]` is untouched. The manifest validator reports the file valid. Decision and status unchanged.

## Re-verification — 2026-10-02 (`e020264b54c6872ca98995c1adda18b8451a39af`)

Tripped by ADR-2097 (the rail keyed by chain). `agentbox.toml` changes only inside `[payments.sidestr]` (ADR-2097): its comment block, `chain_id` now `sidestr:dreamlab-txbt4`, and `producer_url` dropped in favour of the chain's derived port; `schema/agentbox.toml.schema.json` changes only `payments.properties.sidestr` (`producer_url` optional, `mirror_url` added). Nothing else this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff e434a7a59..e020264b54c6872ca98995c1adda18b8451a39af -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `agentbox.toml` gains only `[security].role_isolation = false` with its comment (ADR-2122); no other key moved. `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). `setup/agentbox.default.toml` and the schema gain only `role_isolation`. `_ab_vault_resolve` and the `[vault]` resolution are unchanged and still run before any consumer. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`d3ff8e9a876e6b026b543f8824487e002e04cfa0`)

Tripped by the G-5 Q15 correction (`custody/w8-key-split`). `agentbox.toml` changed only in the trailing comments of two allowlist entries: `b41654017f…2f7a` is relabelled as the operator's NIP-07 31403 decision signer (it is `[sovereign_mesh.operator].pubkey_hex`), not visionclaw-server, and the `11ed6422…663c` entry in `[interaction_plane.proxy]` notes that its Podkey-vault copy is to be replaced by K_browser. No key, value, table or list member moved. `setup/agentbox.default.toml` received the same comment correction on its `b41654017f…` relay entry and nothing else. `node scripts/agentbox-config-validate.js agentbox.toml` is valid with the same 5 advisory warnings as `origin/main` (`0919dc39a`). Decision and status unchanged.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `agentbox.toml` changed only in the trailing comments of two allowlist entries (`d3ff8e9a8`, the Q15 correction: `b4165401` is the operator's decision signer). `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on. `setup/agentbox.default.toml` changed only in the same allowlist comment (`d3ff8e9a8`).
`[vault]` stays the single path authority; no vault path or consumer changes. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `config/entrypoint-unified.sh` (`dc91e092a`) gains `_ab_devuser_privilege_check` and its call after the docker-socket check; it reads files only and is a no-op with `[security].role_isolation` off. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.
