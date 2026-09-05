---
id: ADR-2028
title: "`[vault]` in agentbox.toml is the single path authority for the authored corpus; no consumer hard-codes a Logseq path"
date: 2026-09-02
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
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
   format = "obsidian"                         # obsidian | logseq-legacy (read-tolerance only)
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
   `format` becomes `obsidian`. The Logseq option remains selectable but is
   documented as legacy.
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

**Acceptance condition:** Define and test manifest/environment/legacy precedence, disabled-with-override behaviour, path relocation and consumer read identity. Include namespaces, private pages and absent roots; removing old path literals is not proof of equivalent inclusion. Reopen on resolver, consumer, launcher, storage or TUI changes. Both shell files pass syntax checking; no live terminal/editor or image activation test ran. See the [vault review](../../../../VisionFlow/docs/estate-review/authored-vault-transition.md#runtime-path-overrides-and-notes-launch) and [source/probe receipt](../../../../VisionFlow/docs/estate-review/evidence/vault-path-probe.json).

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
