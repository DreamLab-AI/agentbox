---
id: ADR-2057
title: Close the capability-gate gaps for podcast-cron, harness and precedent
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: []
owner: jjohare
review_trigger: any of the three gaps being closed, or a new supervised program landing without a manifest gate
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2020 (capability gating), legacy ADR-039 (apply classes in the system-manifest catalogue), ADR-2021 (skills lint)
---

# ADR-2057 — Close the capability-gate gaps for podcast-cron, harness and precedent

## Context

`docs/GOVERNANCE-capabilities.md` states the byte-identical-when-off invariant: a
disabled `[skills.*]` / `[dream_machine]` gate leaves no runtime trace. Three surfaces
do not satisfy it, found while diagramming the capability estate (AB-27.10, AB-22.13,
AB-28.8):

1. **`[program:podcast-cron]` is ungated.** Every other media/GPU program in `flake.nix`
   is wrapped in `lib.optionalString <gate>`; this one is not, and no
   `[skills.podcast*]` key exists in `agentbox.toml`. It is an unconditional,
   always-autostarted supercronic job, so the podcast ingest surface cannot be turned
   off from the manifest at all.
2. **`[skills.harness]` and `[skills.precedent]` are enforced by file presence, not by
   their gate.** Their registration blocks in `config/entrypoint-unified.sh` check only
   that the server file exists; they never read `.enabled`. Setting
   `[skills.harness] enabled = false` therefore does nothing — the MCP server is still
   registered. Every other `[skills.*]` gate is honoured at registration.
3. **Neither appears in the apply-class catalogue.** `management-api/lib/system-manifest.js`
   has no entry for `harness` or `precedent`, so neither carries an honest
   `live`/`boot`/`rebuild` apply class, which ADR-039 requires of every gate.

A related dead end: `[skills.harness].template_dir` is set in `agentbox.toml` but
`HARNESS_TEMPLATE_DIR` is never exported by the entrypoint, so `harness-bridge.js`
silently uses its hardcoded default. The manifest key is inert.

## Decision

**Accepted and implemented** (2026-09-05). The record was originally written as
proposed-only because every file that had to change belongs to the runtime lane
(`flake.nix`, `agentbox.toml`, `config/entrypoint-unified.sh`,
`management-api/lib/system-manifest.js`); that owner has now landed all four gaps.
See *Verification — 2026-09-05* below for the executed evidence and the two places
where the shipped implementation is narrower than the acceptance test.

The decision is:

- `podcast-cron` gains a manifest gate (`[skills.podcast_ingest] enabled`, default
  matching today's shipped behaviour so the change is not a silent capability removal)
  and its supervisor block is wrapped in the corresponding `lib.optionalString`.
- The `harness` and `precedent` registration blocks read their manifest gate and skip
  registration when it is false, exactly as the other `[skills.*]` blocks do.
- All three gain `system-manifest.js` catalogue entries with honest apply classes.
- `template_dir` is either exported as `HARNESS_TEMPLATE_DIR` and read by
  `harness-bridge.js`, or removed from `agentbox.toml`. An inert manifest key is worse
  than no key: it advertises control that does not exist.

## Consequences

- Until this lands, `byte-identical-when-off` is **false** for three surfaces, and the
  governing doc's invariant overstates the estate. The invariant is not weakened to
  match; the gap is named in the doc's divergence list instead, because the invariant is
  the target and the code is what is wrong.
- Closing gap 2 is a behaviour change for anyone who set `enabled = false` and did not
  notice it was ignored: their harness/precedent MCP servers will stop registering. That
  is the correct outcome and should be called out in the change that lands it.
- Gap 1's gate must default to today's behaviour, or enabling the manifest key becomes a
  required migration step for existing deployments.

## Verification — findings (pre-implementation)

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535`. This section is the original
gap-finding evidence, retained as the "before" state; the implementation evidence
is in *Verification — 2026-09-05* below.

Evidence for each gap:

- `grep -n '^\[program:podcast-cron\]' flake.nix` → present with no enclosing
  `lib.optionalString`, unlike every other media/GPU program;
  `grep -n 'podcast' agentbox.toml` → no gate key.
- `grep -n 'harness-bridge\|precedent-bridge' config/entrypoint-unified.sh` → the two
  registration blocks, both conditioned on file presence only, with no read of
  `skills.harness.enabled` / `skills.precedent.enabled`.
- `grep -n 'harness\|precedent' management-api/lib/system-manifest.js` → no catalogue
  entry for either.
- `grep -n 'template_dir' agentbox.toml` → the key is set;
  `grep -c 'HARNESS_TEMPLATE_DIR' config/entrypoint-unified.sh` → **0**.

**Acceptance test for the landing change:** with `[skills.harness] enabled = false`, a
boot produces a workspace `.mcp.json` with no `harness-bridge` entry and no
`/opt/agentbox/mcp/servers/harness-bridge.js` process; the same for `precedent`; with
the podcast gate false, `supervisorctl status` lists no `podcast-cron`; and
`node scripts/agentbox-config-validate.js` exits 0 with the three new catalogue entries
present.

## Verification — 2026-09-05

Verification ran on the **uncommitted working tree** above
`08e817f394a908264c378745193bf7a0bbf6ec0e`, not on a landing commit, so
`verified_paths` stays empty and the checks must be re-run at the commit that lands
them. `nix eval` / `nix-instantiate` are not available in this container, so the
`flake.nix` edit is verified by reading and by grep, not by evaluation —
`activation_status: staged`, because the podcast gate only takes effect at the next
`./agentbox.sh rebuild`.

### Commands and results

| Command | Result |
|---|---|
| `node scripts/agentbox-config-validate.js agentbox.toml` | **rc=0** — `agentbox manifest valid` (5 pre-existing advisory warnings: W017 ×3, W063, W045 — unchanged from before the edit) |
| `node scripts/agentbox-config-validate.js setup/agentbox.default.toml` | **rc=0** — `agentbox manifest valid` (same 5 pre-existing warnings) |
| `bash -n config/entrypoint-unified.sh` | **rc=0** |
| `node scripts/ci/check-manifest-catalogue.js` | **rc=0** — `PASS: all 60 catalogue gate paths resolve` (was 57; +3). `skills.harness.enabled`, `skills.precedent.enabled` and `skills.podcast_ingest.enabled` no longer appear in the uncatalogued-drift warning list |
| `node --test tests/config/mcp-projector.test.mjs` | **pass 1 / fail 0** |
| `tests/config/semantic-rules.test.js` | **64 pass / 3 fail / 1 skipped.** The intended runner (`package.json` `test:config` = jest) did not terminate within 12 min in this container (whole-tree haste crawl) and `node --test` cannot load the file at all (`ReferenceError: describe is not defined`), so the suite was executed under a minimal `describe`/`test`/`expect` shim. All 3 failures are pre-existing drift in provider/consultant rules this change does not touch: the fixtures are built by a hand-written `baseValid()` literal, independent of both manifests. Probed directly — the E017 fixture now yields `W017 … exit 0` (the rule was downgraded from error to advisory warning and the test was never updated); `W038` fails symmetrically. No failure involves a `[skills.*]` gate |
| schema negative control: append `[skills.definitely_not_a_real_gate]` to a copy of `agentbox.toml`, re-validate | **rc=1**, `E016 UnknownManifestKey: unknown key ... at /skills` — proves `skills` is `additionalProperties: false` and that the new `podcast_ingest` schema entry is load-bearing, not decorative |
| `grep -n 'podcastIngestEnabled' flake.nix` | defined once (`flake.nix:169`), used once (`flake.nix:2402`) — see the scope note below on why there is no second use |
| `grep -n 'HARNESS_TEMPLATE_DIR' mcp/servers/harness-bridge.js config/entrypoint-unified.sh` | server reads it at `harness-bridge.js:25`; the entrypoint now sets it (was **0** occurrences) |
| `node scripts/adr-index-gen.js docs/adr` | reports **ADR-2031** STALE on `config/entrypoint-unified.sh`. Pre-existing, not caused here: `git diff --stat ec257a2..08e817f3 -- config/entrypoint-unified.sh` shows 204 insertions already landed between that record's `verified_commit` and HEAD. ADR-2031 is outside this change's ownership; the index regenerates once it is re-verified |

### What landed, per gap

1. **podcast-cron gated.** `[skills.podcast_ingest] enabled = true` in `agentbox.toml`,
   `setup/agentbox.default.toml` and `schema/agentbox.toml.schema.json`;
   `podcastIngestEnabled = (skillsCfg.podcast_ingest or {}).enabled or true`
   (`flake.nix:169`, the same `or true` defaulting shape as `mcpHubEnabled` /
   `hookShimEnabled` / `teammateGcEnabled`) wraps `[program:podcast-cron]` in
   `lib.optionalString` (`flake.nix:2402`). The `or true` default is what keeps this
   from being a silent capability removal, as *Consequences* requires.
2. **harness / precedent gates honoured.** Both registration blocks in
   `config/entrypoint-unified.sh` now read `skills.<gate>.enabled` via
   `agentbox-manifest toml-bool` before registering, mirroring `_CODE_SERVER_ON` /
   `_CONSULTANTS_ON`.
3. **Catalogue entries added** to `management-api/lib/system-manifest.js`:
   `harness-bridge` and `precedent-bridge` are `boot` (an entrypoint registration gate
   applies on restart); `podcast-ingest` is `rebuild` (flake-baked supervisor text).
4. **`template_dir` made live, not removed.** `harness-bridge.js:25` has always read
   `HARNESS_TEMPLATE_DIR`; only the export was missing. The entrypoint now reads
   `skills.harness.template_dir` with `agentbox-manifest toml-string` and projects it
   into the server's `.mcp.json` env block, falling back to the server's own
   `/var/lib/agentbox/harness-templates` when unset so an absent key changes nothing.
   The harness block's `grep -q` guard was dropped (mirroring the ontology-bridge
   block, which drops it for exactly this reason) so a `template_dir` change
   propagates on every boot instead of being frozen at first registration.

### Where the implementation is narrower than the acceptance test

Two honest divergences, both recorded rather than papered over:

- **Gate-off skips registration; it does not retract an existing entry.** The
  acceptance test asks that a boot with `enabled = false` produce a `.mcp.json` with
  no `harness-bridge`/`precedent-bridge` entry. That holds for a fresh workspace. It
  does **not** retract an entry a previous boot already wrote: `agentbox-manifest` has
  `mcp-set-server` but no remove-by-name subcommand, and neither bridge is in
  `skills/mcp.json`, so the reconcile-and-remove path in `project-mcp-servers.mjs`
  (which only manages projector-owned servers) never sees them. Closing this needs a
  new `agentbox-manifest` subcommand — out of scope here, and the natural follow-up.
- **The podcast gate governs the schedule, not the closure.** `false` removes
  `[program:podcast-cron]` but leaves the `podcast-ingest` binary and `supercronic` in
  the image. Both are shared with always-baked surfaces — the
  `podcast-{knowledge,bulk}-ingest` skills invoke the binary by hand, and
  `[program:forum-backup-cron]` uses the same supercronic derivation — so removing
  either from the package set would break unrelated capability. `byte-identical-when-off`
  therefore holds for the *runtime* trace (no program, no log files, no cron) but not
  for the image closure. The catalogue summary and the manifest comment both say so.

Consequently the *Consequences* note stands as written: anyone who had set
`[skills.harness]`/`[skills.precedent]` `enabled = false` and never noticed it was
ignored will now, on a fresh workspace, stop getting those MCP servers. That is the
intended outcome.
